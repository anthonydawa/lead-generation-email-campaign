import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_NAMES = new Set([
  "admin",
  "contact",
  "hello",
  "help",
  "info",
  "office",
  "sales",
  "support",
  "team",
]);
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "yopmail.com",
]);

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as FinderInput;
    if (input.verify_email) return verifySuppliedEmail(input.verify_email);
    const website = safeWebsite(input.website || "");
    const person = splitName(input.person_name || "");
    const source = safePublicUrl(input.person_source_url || "");
    if (!website || !person.first || !person.last) {
      return NextResponse.json(
        {
          error:
            "A full first and last name plus the company website are required.",
        },
        { status: 400 },
      );
    }

    const domain = website.hostname.replace(/^www\./, "").toLowerCase();
    const cachedDomain = await loadDomainIntelligence(domain);
    const mx =
      cachedDomain?.mx_found !== null &&
      cachedDomain?.mx_found !== undefined &&
      cacheIsFresh(cachedDomain.expires_at)
        ? {
            found: cachedDomain.mx_found,
            records: cachedDomain.mx_records || [],
            cached: true,
          }
        : { ...(await checkMx(domain)), cached: false };
    if (!mx.found) {
      await saveDomainIntelligence({
        domain,
        mx,
        observedEmails: cachedDomain?.observed_emails || [],
        pattern: cachedDomain?.email_pattern || null,
        patternConfidence: cachedDomain?.pattern_confidence || 0,
        evidenceUrls: cachedDomain?.evidence_urls || [],
      });
      return NextResponse.json({
        person: input.person_name,
        domain,
        mx,
        candidates: [],
        providers: [],
        error: "This company domain does not publish a working MX record.",
      });
    }

    const publicEvidence = await collectPublicEvidence(
      source,
      website,
      person,
      input.public_emails || [],
      input.evidence_urls || [],
    );
    const providerRuns = new Map<string, ProviderStatus>();
    const observedEmails = unique([
      ...(cachedDomain?.observed_emails || []),
      ...publicEvidence.companyEmails,
    ]);
    const currentPattern = bestPattern(
      person,
      publicEvidence.personEmails,
      cachedDomain,
    );
    const generated = rankGeneratedCandidates(
      person,
      domain,
      observedEmails,
      currentPattern.pattern,
    );
    let finderResult: FinderResult | null = null;
    let finderSkippedReason = "";
    let candidateEmails: string[] = [];

    if (publicEvidence.personEmails.length) {
      finderSkippedReason = "published_email";
      candidateEmails = unique([...publicEvidence.personEmails, ...generated]);
    } else if (currentPattern.pattern && currentPattern.confidence >= 70) {
      finderSkippedReason = "company_pattern";
      candidateEmails = unique([
        applyPattern(currentPattern.pattern, person, domain),
        ...generated,
      ]);
    } else {
      finderResult = await findWithProviders(
        person,
        domain,
        input.company_name || "",
        providerRuns,
      );
      candidateEmails = unique([
        ...(finderResult?.email ? [finderResult.email] : []),
        ...generated,
      ]);
    }

    const candidates: ContactCandidate[] = [];
    let verificationCacheHits = 0;
    for (const email of candidateEmails.slice(0, 4)) {
      const origin = publicEvidence.personEmails.includes(email)
        ? "published"
        : finderResult?.email === email
          ? "finder"
          : "inferred";
      const evidenceUrls =
        origin === "published"
          ? publicEvidence.evidenceUrls
          : unique([
              ...publicEvidence.evidenceUrls,
              ...(finderResult?.sources || []),
            ]).slice(0, 12);

      const cachedVerification = await loadVerificationCache(email);
      const verification =
        cachedVerification ||
        finderVerification(finderResult, email) ||
        (await verifySequentially(email, providerRuns));
      if (cachedVerification) verificationCacheHits += 1;
      if (verification && !cachedVerification && !verification.cached)
        await saveVerificationCache(email, verification);
      const status = verification?.status || "unknown";
      const catchAll = Boolean(verification?.catch_all);
      const disposable =
        Boolean(verification?.disposable) ||
        DISPOSABLE_DOMAINS.has(domain);
      const roleAddress =
        Boolean(verification?.role) ||
        ROLE_NAMES.has(email.split("@")[0].toLowerCase());
      const campaignEligible =
        status === "deliverable" &&
        !catchAll &&
        !disposable &&
        !roleAddress;
      const confidence = calculateConfidence({
        origin,
        status,
        score: verification?.score || finderResult?.score || 0,
        catchAll,
        disposable,
        roleAddress,
      });

      candidates.push({
        email,
        origin,
        status,
        confidence,
        provider:
          verification?.provider ||
          (finderResult?.email === email ? finderResult.provider : "local"),
        reason:
          verification?.reason ||
          (origin === "published"
            ? "Published on a checked company-controlled page."
            : "Generated from the confirmed name and company domain."),
        mx_found: mx.found,
        catch_all: catchAll,
        disposable,
        role_address: roleAddress,
        campaign_eligible: campaignEligible,
        evidence_urls: evidenceUrls,
        verification_details: {
          ...asRecord(verification?.details),
          cached: Boolean(verification?.cached),
        },
      });
      if (campaignEligible || status !== "undeliverable") break;
    }

    if (
      finderSkippedReason &&
      candidates.length &&
      candidates.every((candidate) => candidate.status === "undeliverable")
    ) {
      finderSkippedReason = "";
      finderResult = await findWithProviders(
        person,
        domain,
        input.company_name || "",
        providerRuns,
      );
      if (
        finderResult?.email &&
        !candidates.some((candidate) => candidate.email === finderResult?.email)
      ) {
        const verification =
          finderVerification(finderResult, finderResult.email) ||
          (await loadVerificationCache(finderResult.email)) ||
          (await verifySequentially(finderResult.email, providerRuns));
        if (verification && !verification.cached)
          await saveVerificationCache(finderResult.email, verification);
        candidates.push(
          buildCandidate({
            email: finderResult.email,
            origin: "finder",
            verification,
            finderResult,
            mxFound: mx.found,
            evidenceUrls: unique([
              ...publicEvidence.evidenceUrls,
              ...finderResult.sources,
            ]).slice(0, 12),
          }),
        );
      }
    }

    const successfulCandidate = candidates.find(
      (candidate) =>
        candidate.status === "deliverable" &&
        !candidate.catch_all &&
        !candidate.disposable &&
        !candidate.role_address,
    );
    const successfulPattern = successfulCandidate
      ? detectPattern(successfulCandidate.email, person)
      : null;
    const learnedPattern = successfulPattern
      ? {
          pattern: successfulPattern,
          confidence: successfulCandidate?.origin === "published" ? 95 : 90,
        }
      : currentPattern;
    await saveDomainIntelligence({
      domain,
      mx,
      observedEmails: unique([
        ...observedEmails,
        ...candidates
          .filter(
            (candidate) =>
              candidate.origin === "published" ||
              candidate.status === "deliverable",
          )
          .map((candidate) => candidate.email),
      ]),
      pattern: learnedPattern.pattern,
      patternConfidence: learnedPattern.confidence,
      evidenceUrls: publicEvidence.evidenceUrls,
    });

    return NextResponse.json({
      person: input.person_name,
      role: input.role || "",
      company_name: input.company_name || "",
      website: website.origin,
      person_source_url:
        publicEvidence.personSourceUrl || source?.toString() || website.toString(),
      domain,
      mx,
      candidates,
      providers: [...providerRuns.values()],
      verifier_setup_required: !configuredVerifierNames().length,
      source_discovery: {
        confirmed_on_company_site: publicEvidence.confirmedOnCompanySite,
        inspected_pages: publicEvidence.inspectedPages,
        company_email_examples: publicEvidence.companyEmails.slice(0, 5),
      },
      optimization: {
        finder_skipped_reason: finderSkippedReason || null,
        mx_cache_hit: Boolean(mx.cached),
        verification_cache_hits: verificationCacheHits,
        company_pattern: learnedPattern.pattern || null,
        company_pattern_confidence: learnedPattern.confidence,
        candidates_tested: candidates.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to find this contact.",
      },
      { status: 502 },
    );
  }
}

async function verifySuppliedEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "A valid email address is required." },
      { status: 400 },
    );
  }
  const cached = await loadVerificationCache(email);
  const providerRuns = new Map<string, ProviderStatus>();
  const verification = cached || (await verifySequentially(email, providerRuns));
  if (verification && !cached && !verification.cached) {
    await saveVerificationCache(email, verification);
  }
  const domain = email.split("@")[1];
  const roleAddress =
    Boolean(verification?.role) || ROLE_NAMES.has(email.split("@")[0]);
  const disposable =
    Boolean(verification?.disposable) || DISPOSABLE_DOMAINS.has(domain);
  const catchAll = Boolean(verification?.catch_all);
  const status = verification?.status || "unknown";
  const campaignEligible =
    status === "deliverable" && !catchAll && !disposable && !roleAddress;
  const providers = [...providerRuns.values()];
  const exhausted =
    providers.length > 0 &&
    providers.every((provider) => provider.status === "exhausted");

  return NextResponse.json({
    email,
    status,
    campaign_eligible: campaignEligible,
    catch_all: catchAll,
    disposable,
    role_address: roleAddress,
    provider: verification?.provider || "",
    reason:
      verification?.reason ||
      (exhausted
        ? "All configured verifier credits are currently exhausted."
        : "No verifier result is currently available."),
    cached: Boolean(cached),
    providers,
    verifier_setup_required: !configuredVerifierNames().length,
    queued_for_retry: !verification || status === "unknown" || exhausted,
  });
}

const FINDER_CONFIG = {
  hunter: {
    keys: ["HUNTER_API_KEY"],
    provider: "hunter",
    operation: "email_finder",
    usageOperations: ["email_finder", "email_verify"],
    limitKey: "HUNTER_MONTHLY_LIMIT",
    defaultLimit: 50,
    period: "monthly",
  },
  zerobounce_finder: {
    keys: ["ZEROBOUNCE_API_KEY"],
    provider: "zerobounce",
    operation: "email_finder",
    usageOperations: ["email_finder"],
    limitKey: "ZEROBOUNCE_FINDER_MONTHLY_LIMIT",
    defaultLimit: 10,
    period: "monthly",
  },
} as const;

const VERIFIER_CONFIG = {
  hunter: {
    keys: ["HUNTER_API_KEY"],
    provider: "hunter",
    operation: "email_verify",
    usageOperations: ["email_finder", "email_verify"],
    limitKey: "HUNTER_MONTHLY_LIMIT",
    defaultLimit: 50,
    period: "monthly",
  },
  zerobounce: {
    keys: ["ZEROBOUNCE_API_KEY"],
    provider: "zerobounce",
    operation: "email_verify",
    usageOperations: ["email_verify"],
    limitKey: "ZEROBOUNCE_MONTHLY_LIMIT",
    defaultLimit: 100,
    period: "monthly",
  },
  mailboxlayer: {
    keys: ["MAILBOXLAYER_API_KEY"],
    provider: "mailboxlayer",
    operation: "email_verify",
    usageOperations: ["email_verify"],
    limitKey: "MAILBOXLAYER_MONTHLY_LIMIT",
    defaultLimit: 100,
    period: "monthly",
  },
  verifalia: {
    keys: ["VERIFALIA_USERNAME", "VERIFALIA_PASSWORD"],
    provider: "verifalia",
    operation: "email_verify",
    usageOperations: ["email_verify"],
    limitKey: "VERIFALIA_DAILY_LIMIT",
    defaultLimit: 25,
    period: "daily",
  },
  bouncer: {
    keys: ["BOUNCER_API_KEY"],
    provider: "bouncer",
    operation: "email_verify",
    usageOperations: ["email_verify"],
    limitKey: "BOUNCER_TOTAL_LIMIT",
    defaultLimit: 100,
    period: "all_time",
  },
} as const;

type FinderProvider = keyof typeof FINDER_CONFIG;
type VerifierProvider = keyof typeof VERIFIER_CONFIG;

async function findWithProviders(
  person: NameParts,
  domain: string,
  company: string,
  runs: Map<string, ProviderStatus>,
): Promise<FinderResult | null> {
  for (const name of Object.keys(FINDER_CONFIG) as FinderProvider[]) {
    const config = FINDER_CONFIG[name];
    const runName = name === "hunter" ? "hunter_finder" : name;
    if (!config.keys.every((key) => process.env[key]?.trim())) continue;
    const available = await providerAvailable(config);
    if (!available.ok) {
      setRun(runs, {
        name: runName,
        status: "exhausted",
        used: available.used,
        limit: available.limit,
      });
      continue;
    }
    try {
      const result =
        name === "hunter"
          ? await hunterFind(person, domain)
          : await zeroBounceFind(person, domain, company);
      await recordUsage(config.provider, config.operation, true);
      setRun(runs, {
        name: runName,
        status: "used",
        used: available.used + 1,
        limit: available.limit,
      });
      if (result?.email && validCompanyEmail(result.email, domain)) return result;
    } catch (error) {
      await recordUsage(config.provider, config.operation, false);
      const exhausted = isQuotaError(error);
      setRun(runs, {
        name: runName,
        status: exhausted ? "exhausted" : "error",
        used: exhausted ? available.limit : available.used,
        limit: available.limit,
        error: error instanceof Error ? error.message : "Finder failed",
      });
    }
  }
  return null;
}

async function verifySequentially(
  email: string,
  runs: Map<string, ProviderStatus>,
): Promise<VerificationResult | null> {
  for (const name of Object.keys(VERIFIER_CONFIG) as VerifierProvider[]) {
    const config = VERIFIER_CONFIG[name];
    const runName = `${name}_verifier`;
    if (!config.keys.every((key) => process.env[key]?.trim())) continue;
    const available = await providerAvailable(config);
    if (!available.ok) {
      setRun(runs, {
        name: runName,
        status: "exhausted",
        used: available.used,
        limit: available.limit,
      });
      continue;
    }
    try {
      const result = await callVerifier(name, email);
      await recordUsage(config.provider, config.operation, true);
      setRun(runs, {
        name: runName,
        status: "used",
        used: available.used + 1,
        limit: available.limit,
      });
      if (result.status !== "unknown") return result;
    } catch (error) {
      await recordUsage(config.provider, config.operation, false);
      const exhausted = isQuotaError(error);
      setRun(runs, {
        name: runName,
        status: exhausted ? "exhausted" : "error",
        used: exhausted ? available.limit : available.used,
        limit: available.limit,
        error: error instanceof Error ? error.message : "Verifier failed",
      });
    }
  }
  return null;
}

async function hunterFind(person: NameParts, domain: string) {
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", domain);
  url.searchParams.set("first_name", person.first);
  url.searchParams.set("last_name", person.last);
  url.searchParams.set("api_key", process.env.HUNTER_API_KEY || "");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const data = (await response.json()) as {
    data?: {
      email?: string;
      score?: number;
      sources?: Array<{ uri?: string }>;
      verification?: {
        status?: string;
        date?: string;
      };
    };
    errors?: Array<{ details?: string }>;
  };
  if (!response.ok)
    throw new ProviderError(
      data.errors?.[0]?.details || "Hunter finder failed",
      response.status,
    );
  return {
    email: String(data.data?.email || "").toLowerCase(),
    score: Number(data.data?.score || 0),
    provider: "hunter",
    sources: (data.data?.sources || []).map((source) => source.uri || "").filter(Boolean),
    verification: data.data?.verification?.status
      ? {
          provider: "hunter_finder",
          status: mapStatus(data.data.verification.status),
          score: Number(data.data?.score || 0),
          catch_all: /accept.?all|catch.?all/i.test(
            data.data.verification.status,
          ),
          disposable: false,
          role: false,
          reason: `Hunter finder verification: ${data.data.verification.status}`,
          details: data.data.verification,
        }
      : null,
  };
}

async function zeroBounceFind(
  person: NameParts,
  domain: string,
  company: string,
) {
  const url = new URL("https://api.zerobounce.net/v2/guessformat");
  url.searchParams.set("api_key", process.env.ZEROBOUNCE_API_KEY || "");
  url.searchParams.set("domain", domain);
  url.searchParams.set("company_name", company || domain);
  url.searchParams.set("first_name", person.first);
  url.searchParams.set("last_name", person.last);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  const data = (await response.json()) as {
    email?: string;
    email_confidence?: string;
    email_conficence?: string;
    failure_reason?: string;
  };
  if (!response.ok || (!data.email && /credit|quota/i.test(data.failure_reason || "")))
    throw new ProviderError(
      data.failure_reason || "ZeroBounce finder failed",
      response.ok ? 429 : response.status,
    );
  const confidence = data.email_confidence || data.email_conficence || "";
  return {
    email: String(data.email || "").toLowerCase(),
    score: confidence.toLowerCase() === "high" ? 90 : 65,
    provider: "zerobounce_finder",
    sources: [],
  };
}

async function callVerifier(
  name: VerifierProvider,
  email: string,
): Promise<VerificationResult> {
  if (name === "hunter") {
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", email);
    url.searchParams.set("api_key", process.env.HUNTER_API_KEY || "");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      data?: {
        status?: string;
        score?: number;
        accept_all?: boolean;
        disposable?: boolean;
        webmail?: boolean;
        sources?: Array<{ uri?: string }>;
      };
      errors?: Array<{ details?: string }>;
    };
    if (!response.ok)
      throw new ProviderError(
        payload.errors?.[0]?.details || "Hunter verifier failed",
        response.status,
      );
    const value = payload.data || {};
    return result({
      provider: name,
      status: mapStatus(value.status),
      score: Number(value.score || 0),
      catch_all: Boolean(value.accept_all),
      disposable: Boolean(value.disposable || value.webmail),
      role: false,
      reason: value.status || "Hunter verification completed",
      details: value,
    });
  }

  if (name === "zerobounce") {
    const url = new URL("https://api.zerobounce.net/v2/validate");
    url.searchParams.set("api_key", process.env.ZEROBOUNCE_API_KEY || "");
    url.searchParams.set("email", email);
    url.searchParams.set("timeout", "25");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const value = (await response.json()) as {
      status?: string;
      sub_status?: string;
      catchall_domain?: boolean;
      free_email?: boolean;
      did_you_mean?: string;
      error?: string;
    };
    if (!response.ok || value.error)
      throw new ProviderError(
        value.error || "ZeroBounce verifier failed",
        response.status,
      );
    return result({
      provider: name,
      status: mapStatus(value.status),
      score: value.status === "valid" ? 95 : 0,
      catch_all:
        Boolean(value.catchall_domain) ||
        /catch.?all/i.test(value.status || value.sub_status || ""),
      disposable: /spamtrap|abuse|do_not_mail/i.test(
        `${value.status} ${value.sub_status}`,
      ),
      role: /role/i.test(value.sub_status || ""),
      reason: value.sub_status || value.status || "ZeroBounce verification completed",
      details: value,
    });
  }

  if (name === "mailboxlayer") {
    const url = new URL("https://apilayer.net/api/check");
    url.searchParams.set("access_key", process.env.MAILBOXLAYER_API_KEY || "");
    url.searchParams.set("email", email);
    url.searchParams.set("smtp", "1");
    url.searchParams.set("format", "1");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const value = (await response.json()) as {
      format_valid?: boolean;
      mx_found?: boolean;
      smtp_check?: boolean;
      catch_all?: boolean;
      role?: boolean;
      disposable?: boolean;
      score?: number;
      error?: { info?: string; code?: number };
    };
    if (!response.ok || value.error)
      throw new ProviderError(
        value.error?.info || "Mailboxlayer verifier failed",
        value.error?.code === 104 ? 429 : response.status,
      );
    return result({
      provider: name,
      status:
        value.format_valid && value.mx_found && value.smtp_check
          ? "deliverable"
          : value.format_valid === false || value.mx_found === false
            ? "undeliverable"
            : "unknown",
      score: Math.round(Number(value.score || 0) * 100),
      catch_all: Boolean(value.catch_all),
      disposable: Boolean(value.disposable),
      role: Boolean(value.role),
      reason: value.smtp_check ? "SMTP mailbox accepted" : "SMTP result unavailable",
      details: value,
    });
  }

  if (name === "verifalia") {
    const auth = `Basic ${btoa(
      `${process.env.VERIFALIA_USERNAME}:${process.env.VERIFALIA_PASSWORD}`,
    )}`;
    let response = await fetch(
      "https://api.verifalia.com/v2.7/email-validations?waitTime=30000",
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ inputData: email }], quality: "Standard" }),
        signal: AbortSignal.timeout(35_000),
        cache: "no-store",
      },
    );
    let value = (await response.json()) as VerifaliaSnapshot;
    if (response.status === 202) {
      const location = response.headers.get("location");
      if (!location) return unknownResult(name, "Verification is still processing");
      response = await fetch(`${location}${location.includes("?") ? "&" : "?"}waitTime=30000`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(35_000),
        cache: "no-store",
      });
      value = (await response.json()) as VerifaliaSnapshot;
    }
    if (!response.ok)
      throw new ProviderError(
        readMessage(value) || "Verifalia verifier failed",
        response.status,
      );
    const entry = value.entries?.data?.[0];
    if (!entry) return unknownResult(name, "Verification result not ready");
    return result({
      provider: name,
      status: mapStatus(entry.classification),
      score: entry.classification === "Deliverable" ? 95 : 0,
      catch_all: /catch.?all/i.test(entry.status || ""),
      disposable: Boolean(entry.isDisposableEmailAddress),
      role: Boolean(entry.isRoleAccount),
      reason: entry.status || entry.classification || "Verifalia completed",
      details: entry,
    });
  }

  const url = new URL("https://api.usebouncer.com/v1.1/email/verify");
  url.searchParams.set("email", email);
  const response = await fetch(url, {
    headers: { "x-api-key": process.env.BOUNCER_API_KEY || "" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const value = (await response.json()) as {
    status?: string;
    reason?: string;
    score?: number;
    domain?: { acceptAll?: string; disposable?: string };
    account?: { role?: string };
    message?: string;
  };
  if (!response.ok)
    throw new ProviderError(
      value.message || "Bouncer verifier failed",
      response.status,
    );
  return result({
    provider: name,
    status: mapStatus(value.status),
    score: Number(value.score || 0),
    catch_all: value.domain?.acceptAll === "yes",
    disposable: value.domain?.disposable === "yes",
    role: value.account?.role === "yes",
    reason: value.reason || value.status || "Bouncer verification completed",
    details: value,
  });
}

async function collectPublicEvidence(
  personSource: URL | null,
  website: URL,
  person: NameParts,
  supplied: string[],
  suppliedEvidence: string[],
) {
  const domain = website.hostname.replace(/^www\./, "");
  const personCandidates = new Set(generateCandidates(person, domain));
  const suppliedPersonEmails = supplied
    .map((email) => email.toLowerCase())
    .filter(
      (email) =>
        validCompanyEmail(email, domain) && personCandidates.has(email),
    );
  const standardPaths = [
    "/",
    "/about",
    "/about-us",
    "/team",
    "/our-team",
    "/leadership",
    "/people",
    "/contact",
  ];
  const initialUrls = unique([
    ...(personSource?.origin === website.origin ? [personSource.toString()] : []),
    ...suppliedEvidence.filter((value) => sameOrigin(value, website.origin)),
    ...standardPaths.map((path) => new URL(path, website).toString()),
  ]).slice(0, 8);
  const robotsRules = await readRobotsRules(website);
  const pages: CheckedPage[] = [];
  for (const url of initialUrls) {
    const page = await fetchCompanyPage(url, website.origin, robotsRules);
    if (page) pages.push(page);
  }

  const linkedPersonUrls = unique(
    pages.flatMap((page) => discoverPersonLinks(page, website, person)),
  )
    .filter((url) => !pages.some((page) => page.url === url))
    .slice(0, 3);
  for (const url of linkedPersonUrls) {
    const page = await fetchCompanyPage(url, website.origin, robotsRules);
    if (page) pages.push(page);
  }

  const exactName = normalizeText(`${person.first} ${person.last}`);
  const matchingPages = pages.filter((page) =>
    normalizeText(page.text).includes(exactName),
  );
  const companyEmails = unique([
    ...supplied.map((email) => email.toLowerCase()),
    ...pages.flatMap((page) => page.emails),
  ]).filter((email) => validCompanyEmail(email, domain));
  const personEmails = unique([
    ...suppliedPersonEmails,
    ...matchingPages.flatMap((page) => page.emails),
  ]).filter(
    (email) =>
      validCompanyEmail(email, domain) && personCandidates.has(email),
  );
  const confirmedPage =
    matchingPages.find((page) => page.emails.some((email) => personEmails.includes(email))) ||
    matchingPages[0];

  return {
    personEmails,
    companyEmails,
    confirmedOnCompanySite: Boolean(confirmedPage),
    personSourceUrl:
      confirmedPage?.url ||
      personSource?.toString() ||
      suppliedEvidence[0] ||
      website.toString(),
    evidenceUrls: unique([
      ...matchingPages.map((page) => page.url),
      ...(personSource ? [personSource.toString()] : []),
      ...suppliedEvidence,
    ]).slice(0, 12),
    inspectedPages: pages.map((page) => page.url),
  };
}

async function fetchCompanyPage(
  urlValue: string,
  origin: string,
  disallowedPaths: string[],
) {
  try {
    const url = new URL(urlValue);
    if (url.origin !== origin || !safeHostname(url.hostname)) return null;
    if (
      disallowedPaths.some(
        (path) => path && path !== "/" && url.pathname.startsWith(path),
      ) ||
      disallowedPaths.includes("/")
    )
      return null;
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "User-Agent":
          "RelayLeadResearch/1.0 (+https://relay-campaign-dashboard.vercel.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== origin) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;
    const html = (await response.text()).slice(0, 600_000);
    const decoded = decodeEmailText(html);
    return {
      url: finalUrl.toString(),
      html,
      text: stripHtml(decoded),
      emails: extractEmails(decoded),
    } satisfies CheckedPage;
  } catch {
    return null;
  }
}

async function readRobotsRules(website: URL) {
  try {
    const response = await fetch(new URL("/robots.txt", website), {
      signal: AbortSignal.timeout(4_000),
      headers: {
        "User-Agent":
          "RelayLeadResearch/1.0 (+https://relay-campaign-dashboard.vercel.app)",
        Accept: "text/plain",
      },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const rules: string[] = [];
    let applies = false;
    for (const rawLine of (await response.text()).slice(0, 100_000).split(/\r?\n/)) {
      const line = rawLine.split("#")[0].trim();
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") applies = value === "*";
      else if (applies && key === "disallow" && value) rules.push(value);
    }
    return unique(rules);
  } catch {
    return [];
  }
}

function discoverPersonLinks(page: CheckedPage, website: URL, person: NameParts) {
  const fullSlug = `${slug(person.first)}-${slug(person.last)}`;
  const joinedSlug = `${slug(person.first)}${slug(person.last)}`;
  const links: string[] = [];
  const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,1200}?)<\/a>/gi;
  for (const match of page.html.matchAll(pattern)) {
    const href = match[1] || "";
    const label = normalizeText(stripHtml(match[2] || ""));
    let target: URL;
    try {
      target = new URL(href, page.url);
    } catch {
      continue;
    }
    const pathSlug = slug(target.pathname);
    const nameMatch =
      label.includes(normalizeText(`${person.first} ${person.last}`)) ||
      pathSlug.includes(slug(fullSlug)) ||
      pathSlug.includes(joinedSlug);
    if (
      nameMatch &&
      target.origin === website.origin &&
      !/\.(pdf|jpg|jpeg|png|gif|webp)$/i.test(target.pathname)
    ) {
      target.hash = "";
      links.push(target.toString());
    }
  }
  for (const match of page.html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let target: URL;
    try {
      target = new URL(match[1] || "", page.url);
    } catch {
      continue;
    }
    const pathSlug = slug(target.pathname);
    if (
      target.origin === website.origin &&
      (pathSlug.includes(slug(fullSlug)) || pathSlug.includes(joinedSlug))
    ) {
      target.hash = "";
      links.push(target.toString());
    }
  }
  return links;
}

function extractEmails(value: string) {
  return unique(
    (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(
      (email) => email.toLowerCase().replace(/[),.;:]+$/, ""),
    ),
  );
}

function decodeEmailText(value: string) {
  return value
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".");
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#39;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameOrigin(value: string, origin: string) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

async function checkMx(domain: string) {
  try {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", domain);
    url.searchParams.set("type", "MX");
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const data = (await response.json()) as {
      Status?: number;
      Answer?: Array<{ data?: string }>;
    };
    const records = (data.Answer || [])
      .map((answer) => String(answer.data || "").replace(/^\d+\s+/, ""))
      .filter(Boolean);
    return { found: response.ok && data.Status === 0 && records.length > 0, records };
  } catch {
    return { found: false, records: [] as string[] };
  }
}

function cacheIsFresh(expiresAt?: string | null) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
}

async function loadDomainIntelligence(
  domain: string,
): Promise<DomainIntelligenceRow | null> {
  try {
    const rows = await supabaseRequest<DomainIntelligenceRow[]>(
      `email_domain_intelligence?select=domain,mx_found,mx_records,observed_emails,email_pattern,pattern_confidence,evidence_urls,expires_at&domain=eq.${encodeURIComponent(domain)}&limit=1`,
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function saveDomainIntelligence(input: {
  domain: string;
  mx: { found: boolean; records: string[] };
  observedEmails: string[];
  pattern: string | null;
  patternConfidence: number;
  evidenceUrls: string[];
}) {
  try {
    await supabaseRequest(
      "email_domain_intelligence?on_conflict=domain",
      {
        method: "POST",
        body: JSON.stringify({
          domain: input.domain,
          mx_found: input.mx.found,
          mx_records: input.mx.records,
          observed_emails: unique(input.observedEmails).slice(0, 50),
          email_pattern: input.pattern,
          pattern_confidence: input.patternConfidence,
          evidence_urls: unique(input.evidenceUrls).slice(0, 30),
          checked_at: new Date().toISOString(),
          expires_at: futureIso(7),
          updated_at: new Date().toISOString(),
        }),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
  } catch {
    // The finder still works while the optional cache migration is pending.
  }
}

async function loadVerificationCache(
  email: string,
): Promise<VerificationResult | null> {
  try {
    const rows = await supabaseRequest<VerificationCacheRow[]>(
      `email_verification_cache?select=email,status,score,provider,reason,catch_all,disposable,role_address,details,expires_at&email=eq.${encodeURIComponent(email)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      provider: row.provider,
      status: row.status,
      score: row.score,
      catch_all: row.catch_all,
      disposable: row.disposable,
      role: row.role_address,
      reason: `${row.reason || "Previous verification result"} (cached)`,
      details: row.details || {},
      cached: true,
    };
  } catch {
    return null;
  }
}

async function saveVerificationCache(
  email: string,
  verification: VerificationResult,
) {
  try {
    const ttlDays =
      verification.status === "deliverable"
        ? 30
        : verification.status === "unknown"
          ? 1
          : 7;
    await supabaseRequest(
      "email_verification_cache?on_conflict=email",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          status: verification.status,
          score: verification.score,
          provider: verification.provider,
          reason: verification.reason,
          catch_all: verification.catch_all,
          disposable: verification.disposable,
          role_address: verification.role,
          details: asRecord(verification.details),
          verified_at: new Date().toISOString(),
          expires_at: futureIso(ttlDays),
          updated_at: new Date().toISOString(),
        }),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
  } catch {
    // The finder still works while the optional cache migration is pending.
  }
}

function futureIso(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function bestPattern(
  person: NameParts,
  personEmails: string[],
  cached: DomainIntelligenceRow | null,
) {
  for (const email of personEmails) {
    const pattern = detectPattern(email, person);
    if (pattern) return { pattern, confidence: 95 };
  }
  return {
    pattern: cached?.email_pattern || null,
    confidence: Number(cached?.pattern_confidence || 0),
  };
}

function detectPattern(email: string, person: NameParts) {
  const local = email.split("@")[0]?.toLowerCase();
  const first = slug(person.first);
  const last = slug(person.last);
  const patterns: Array<[string, string]> = [
    ["first.last", `${first}.${last}`],
    ["first_last", `${first}_${last}`],
    ["first-last", `${first}-${last}`],
    ["first", first],
    ["flast", `${first[0]}${last}`],
    ["f.last", `${first[0]}.${last}`],
    ["firstl", `${first}${last[0]}`],
    ["first.l", `${first}.${last[0]}`],
    ["firstlast", `${first}${last}`],
    ["last.first", `${last}.${first}`],
    ["last", last],
  ];
  return patterns.find(([, value]) => value === local)?.[0] || null;
}

function applyPattern(pattern: string, person: NameParts, domain: string) {
  const first = slug(person.first);
  const last = slug(person.last);
  const local =
    {
      "first.last": `${first}.${last}`,
      first_last: `${first}_${last}`,
      "first-last": `${first}-${last}`,
      first,
      flast: `${first[0]}${last}`,
      "f.last": `${first[0]}.${last}`,
      firstl: `${first}${last[0]}`,
      "first.l": `${first}.${last[0]}`,
      firstlast: `${first}${last}`,
      "last.first": `${last}.${first}`,
      last,
    }[pattern] || `${first}.${last}`;
  return `${local}@${domain}`;
}

function finderVerification(
  finder: FinderResult | null,
  email: string,
): VerificationResult | null {
  if (!finder || finder.email !== email || !finder.verification) return null;
  return finder.verification;
}

function buildCandidate(input: {
  email: string;
  origin: string;
  verification: VerificationResult | null;
  finderResult: FinderResult | null;
  mxFound: boolean;
  evidenceUrls: string[];
}): ContactCandidate {
  const status = input.verification?.status || "unknown";
  const catchAll = Boolean(input.verification?.catch_all);
  const domain = input.email.split("@")[1]?.toLowerCase() || "";
  const disposable =
    Boolean(input.verification?.disposable) ||
    DISPOSABLE_DOMAINS.has(domain);
  const roleAddress =
    Boolean(input.verification?.role) ||
    ROLE_NAMES.has(input.email.split("@")[0].toLowerCase());
  const campaignEligible =
    status === "deliverable" && !catchAll && !disposable && !roleAddress;
  return {
    email: input.email,
    origin: input.origin,
    status,
    confidence: calculateConfidence({
      origin: input.origin,
      status,
      score: input.verification?.score || input.finderResult?.score || 0,
      catchAll,
      disposable,
      roleAddress,
    }),
    provider:
      input.verification?.provider || input.finderResult?.provider || "local",
    reason:
      input.verification?.reason ||
      "Returned by an email finder for the confirmed person and company domain.",
    mx_found: input.mxFound,
    catch_all: catchAll,
    disposable,
    role_address: roleAddress,
    campaign_eligible: campaignEligible,
    evidence_urls: input.evidenceUrls,
    verification_details: {
      ...asRecord(input.verification?.details),
      cached: Boolean(input.verification?.cached),
    },
  };
}

function generateCandidates(person: NameParts, domain: string) {
  const first = slug(person.first);
  const last = slug(person.last);
  return unique([
    `${first}.${last}@${domain}`,
    `${first}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first}${last[0]}@${domain}`,
    `${first}_${last}@${domain}`,
    `${first}-${last}@${domain}`,
    `${first[0]}.${last}@${domain}`,
    `${first}.${last[0]}@${domain}`,
    `${last}.${first}@${domain}`,
    `${last}@${domain}`,
  ]);
}

function rankGeneratedCandidates(
  person: NameParts,
  domain: string,
  observedEmails: string[],
  learnedPattern?: string | null,
) {
  const generated = generateCandidates(person, domain);
  const observedLocals = observedEmails
    .map((email) => email.split("@")[0]?.toLowerCase() || "")
    .filter((local) => local && !ROLE_NAMES.has(local));
  const prefersDot = observedLocals.some((local) => local.includes("."));
  const prefersFirstOnly = observedLocals.some(
    (local) => !/[._-]/.test(local) && local.length <= 10,
  );
  const priority = (email: string) => {
    const local = email.split("@")[0];
    if (learnedPattern && email === applyPattern(learnedPattern, person, domain))
      return -1;
    if (prefersDot && local === `${slug(person.first)}.${slug(person.last)}`) return 0;
    if (prefersFirstOnly && local === slug(person.first)) return 1;
    return generated.indexOf(email) + 2;
  };
  return [...generated].sort((a, b) => priority(a) - priority(b));
}

function calculateConfidence(input: {
  origin: string;
  status: string;
  score: number;
  catchAll: boolean;
  disposable: boolean;
  roleAddress: boolean;
}) {
  let score =
    input.status === "deliverable"
      ? Math.max(80, input.score)
      : input.status === "undeliverable"
        ? 5
        : input.origin === "published"
          ? 65
          : input.origin === "finder"
            ? 55
            : 30;
  if (input.catchAll) score = Math.min(score, 55);
  if (input.disposable || input.roleAddress) score = Math.min(score, 25);
  return Math.min(100, Math.max(0, Math.round(score)));
}

function mapStatus(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (/^(valid|deliverable)$/.test(normalized)) return "deliverable";
  if (/invalid|undeliverable/.test(normalized)) return "undeliverable";
  if (/risky|accept.?all|catch.?all|do_not_mail/.test(normalized)) return "risky";
  return "unknown";
}

function result(value: Omit<VerificationResult, "details"> & { details: unknown }) {
  return value as VerificationResult;
}

function unknownResult(provider: string, reason: string): VerificationResult {
  return {
    provider,
    status: "unknown",
    score: 0,
    catch_all: false,
    disposable: false,
    role: false,
    reason,
    details: {},
  };
}

async function providerAvailable(config: {
  provider: string;
  operation: string;
  usageOperations: readonly string[];
  limitKey: string;
  defaultLimit: number;
  period: string;
}) {
  const limit = Math.max(
    1,
    Number(process.env[config.limitKey] || config.defaultLimit),
  );
  const used = await providerUsage(
    config.provider,
    config.period,
    config.usageOperations,
  );
  return { ok: used < limit, used, limit };
}

async function providerUsage(
  provider: string,
  period: string,
  operations: readonly string[],
) {
  try {
    const now = new Date();
    const start =
      period === "monthly"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        : period === "daily"
          ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
          : null;
    const filter = start
      ? `&called_at=gte.${encodeURIComponent(start.toISOString())}`
      : "";
    const operationFilter =
      operations.length === 1
        ? `&operation=eq.${encodeURIComponent(operations[0])}`
        : `&operation=in.(${operations.map(encodeURIComponent).join(",")})`;
    const rows = await supabaseRequest<Array<{ units: number }>>(
      `lead_provider_usage?select=units&provider=eq.${encodeURIComponent(provider)}${operationFilter}${filter}&success=eq.true&limit=10000`,
    );
    return rows.reduce((sum, row) => sum + Number(row.units || 0), 0);
  } catch {
    return 0;
  }
}

async function recordUsage(
  provider: string,
  operation: string,
  success: boolean,
) {
  try {
    await supabaseRequest("lead_provider_usage", {
      method: "POST",
      body: JSON.stringify({
        provider,
        operation,
        units: 1,
        success,
      }),
      prefer: "return=minimal",
    });
  } catch {
    // The lookup remains usable while the optional usage migration is pending.
  }
}

function setRun(
  runs: Map<string, ProviderStatus>,
  next: ProviderStatus,
) {
  const current = runs.get(next.name);
  if (!current || next.status === "used" || current.status !== "used")
    runs.set(next.name, next);
}

function configuredVerifierNames() {
  return (Object.keys(VERIFIER_CONFIG) as VerifierProvider[]).filter((name) =>
    VERIFIER_CONFIG[name].keys.every((key) => process.env[key]?.trim()),
  );
}

function splitName(value: string): NameParts {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function safeWebsite(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!safeHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function safePublicUrl(value: string) {
  return safeWebsite(value);
}

function safeHostname(hostnameValue: string) {
  const hostname = hostnameValue.toLowerCase();
  return !(
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function validCompanyEmail(email: string, domain: string) {
  return (
    EMAIL_RE.test(email) &&
    email.split("@")[1]?.replace(/^www\./, "").toLowerCase() ===
      domain.replace(/^www\./, "").toLowerCase()
  );
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isQuotaError(error: unknown) {
  return (
    error instanceof ProviderError &&
    [402, 422, 429].includes(error.status)
  );
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

type FinderInput = {
  verify_email?: string;
  person_name?: string;
  role?: string;
  person_source_url?: string;
  company_name?: string;
  website?: string;
  public_emails?: string[];
  evidence_urls?: string[];
};

type NameParts = { first: string; last: string };

type ProviderStatus = {
  name: string;
  status: "used" | "exhausted" | "error";
  used: number;
  limit: number;
  error?: string;
};

type VerificationResult = {
  provider: string;
  status: string;
  score: number;
  catch_all: boolean;
  disposable: boolean;
  role: boolean;
  reason: string;
  details: unknown;
  cached?: boolean;
};

type FinderResult = {
  email: string;
  score: number;
  provider: string;
  sources: string[];
  verification?: VerificationResult | null;
};

type DomainIntelligenceRow = {
  domain: string;
  mx_found: boolean | null;
  mx_records: string[];
  observed_emails: string[];
  email_pattern: string | null;
  pattern_confidence: number;
  evidence_urls: string[];
  expires_at: string | null;
};

type VerificationCacheRow = {
  email: string;
  status: string;
  score: number;
  provider: string;
  reason: string | null;
  catch_all: boolean;
  disposable: boolean;
  role_address: boolean;
  details: unknown;
  expires_at: string;
};

type ContactCandidate = {
  email: string;
  origin: string;
  status: string;
  confidence: number;
  provider: string;
  reason: string;
  mx_found: boolean;
  catch_all: boolean;
  disposable: boolean;
  role_address: boolean;
  campaign_eligible: boolean;
  evidence_urls: string[];
  verification_details: unknown;
};

type VerifaliaSnapshot = {
  message?: string;
  entries?: {
    data?: Array<{
      classification?: string;
      status?: string;
      isDisposableEmailAddress?: boolean;
      isRoleAccount?: boolean;
    }>;
  };
};

type CheckedPage = {
  url: string;
  html: string;
  text: string;
  emails: string[];
};
