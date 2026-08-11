import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

const EXCLUDED_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
];

export async function GET(request: NextRequest) {
  const query = clean(request.nextUrl.searchParams.get("query"), 160);
  const location = clean(request.nextUrl.searchParams.get("location"), 100);
  const limit = Math.min(
    15,
    Math.max(3, Number(request.nextUrl.searchParams.get("limit") || "10")),
  );
  if (!query) {
    return NextResponse.json(
      { error: "Enter a niche, service, or type of company." },
      { status: 400 },
    );
  }
  const enabledProviders = configuredProviders();
  if (!enabledProviders.length) {
    return NextResponse.json(
      {
        error:
          "Add at least one supported search API key in Vercel to enable live discovery.",
        setup_required: true,
        supported_keys: [
          "TAVILY_API_KEY",
          "SERPER_API_KEY",
          "BRAVE_SEARCH_API_KEY",
          "SERPAPI_API_KEY",
          "EXA_API_KEY",
        ],
      },
      { status: 503 },
    );
  }

  try {
    const searchQuery = `${query}${location ? ` in ${location}` : ""} official company websites contact`;
    const providerRuns: ProviderRun[] = [];
    let candidates: TavilyResult[] = [];

    // Spend one search credit at a time. A later provider is only called when
    // the current provider is exhausted, fails, or cannot fill the requested
    // number of unique company domains.
    for (const provider of enabledProviders) {
      const run = await runSearchProvider(
        provider,
        searchQuery,
        location,
        limit,
      );
      providerRuns.push(run);
      candidates = uniqueWebsites([
        ...candidates,
        ...run.results,
      ]).slice(0, limit);
      if (candidates.length >= limit) break;
    }
    if (!candidates.length) {
      return NextResponse.json(
        {
          error:
            "No enabled provider returned company websites. Check provider limits or broaden the query.",
          providers: providerRuns.map(publicProviderStatus),
        },
        { status: 429 },
      );
    }
    const leads = await Promise.all(
      candidates.map((candidate) => inspectWebsite(candidate)),
    );
    const enrichedLeads = process.env.HUNTER_API_KEY
      ? await enrichWithHunter(leads)
      : leads;

    return NextResponse.json({
      query,
      location,
      provider: providerRuns
        .filter((run) => run.status === "used")
        .map((run) => run.name)
        .join(","),
      providers: providerRuns.map(publicProviderStatus),
      results: enrichedLeads,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to discover companies.",
      },
      { status: 502 },
    );
  }
}

const PROVIDER_CONFIG = {
  tavily: {
    key: "TAVILY_API_KEY",
    limitKey: "TAVILY_MONTHLY_LIMIT",
    defaultLimit: 1000,
    period: "monthly",
  },
  serper: {
    key: "SERPER_API_KEY",
    limitKey: "SERPER_TOTAL_LIMIT",
    defaultLimit: 2500,
    period: "all_time",
  },
  brave: {
    key: "BRAVE_SEARCH_API_KEY",
    limitKey: "BRAVE_MONTHLY_LIMIT",
    defaultLimit: 1000,
    period: "monthly",
  },
  serpapi: {
    key: "SERPAPI_API_KEY",
    limitKey: "SERPAPI_MONTHLY_LIMIT",
    defaultLimit: 250,
    period: "monthly",
  },
  exa: {
    key: "EXA_API_KEY",
    limitKey: "EXA_MONTHLY_LIMIT",
    defaultLimit: 1000,
    period: "monthly",
  },
} as const;

type ProviderName = keyof typeof PROVIDER_CONFIG;

function configuredProviders() {
  return (Object.keys(PROVIDER_CONFIG) as ProviderName[]).filter(
    (name) => process.env[PROVIDER_CONFIG[name].key]?.trim(),
  );
}

async function runSearchProvider(
  name: ProviderName,
  query: string,
  location: string,
  limit: number,
): Promise<ProviderRun> {
  const config = PROVIDER_CONFIG[name];
  const quota = Math.max(
    1,
    Number(process.env[config.limitKey] || config.defaultLimit),
  );
  const used = await providerUsage(name, config.period);
  if (used >= quota) {
    return { name, status: "exhausted", used, limit: quota, results: [] };
  }

  try {
    const results = await providerSearch(name, query, location, limit);
    await recordProviderUsage(name, true);
    return {
      name,
      status: "used",
      used: used + 1,
      limit: quota,
      results,
    };
  } catch (error) {
    await recordProviderUsage(name, false);
    const exhausted =
      error instanceof ProviderRequestError && error.status === 429;
    return {
      name,
      status: exhausted ? "exhausted" : "error",
      used: exhausted ? quota : used,
      limit: quota,
      results: [],
      error: error instanceof Error ? error.message : "Provider failed",
    };
  }
}

async function providerSearch(
  name: ProviderName,
  query: string,
  location: string,
  limit: number,
): Promise<TavilyResult[]> {
  const key = process.env[PROVIDER_CONFIG[name].key]?.trim() || "";
  if (name === "tavily") {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: "basic",
        max_results: Math.min(20, limit),
        include_answer: false,
        include_raw_content: false,
        exclude_domains: EXCLUDED_HOSTS,
      }),
      cache: "no-store",
    });
    const payload = (await response.json()) as TavilyResponse;
    if (!response.ok)
      throw new ProviderRequestError(
        payload.detail || "Tavily request failed",
        response.status,
      );
    return payload.results ?? [];
  }

  if (name === "serper") {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(20, limit),
        gl: countryCode(location),
      }),
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      organic?: Array<{ title: string; link: string; snippet?: string }>;
      message?: string;
    };
    if (!response.ok)
      throw new ProviderRequestError(
        payload.message || "Serper request failed",
        response.status,
      );
    return (payload.organic ?? []).map((result) => ({
      title: result.title,
      url: result.link,
      content: result.snippet || "",
    }));
  }

  if (name === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(20, limit)));
    url.searchParams.set("country", countryCode(location));
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      web?: { results?: Array<{ title: string; url: string; description?: string }> };
      message?: string;
    };
    if (!response.ok)
      throw new ProviderRequestError(
        payload.message || "Brave request failed",
        response.status,
      );
    return (payload.web?.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      content: result.description || "",
    }));
  }

  if (name === "serpapi") {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(20, limit)));
    url.searchParams.set("api_key", key);
    url.searchParams.set("gl", countryCode(location));
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as {
      organic_results?: Array<{ title: string; link: string; snippet?: string }>;
      error?: string;
    };
    if (!response.ok || payload.error)
      throw new ProviderRequestError(
        payload.error || "SerpApi request failed",
        response.status,
      );
    return (payload.organic_results ?? []).map((result) => ({
      title: result.title,
      url: result.link,
      content: result.snippet || "",
    }));
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: Math.min(20, limit),
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url: string; text?: string }>;
    error?: string;
  };
  if (!response.ok)
    throw new ProviderRequestError(
      payload.error || "Exa request failed",
      response.status,
    );
  return (payload.results ?? []).map((result) => ({
    title: result.title || "",
    url: result.url,
    content: result.text || "",
  }));
}

async function providerUsage(name: string, period: string) {
  try {
    const start =
      period === "monthly"
        ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
        : null;
    const filter = start
      ? `&called_at=gte.${encodeURIComponent(start.toISOString())}`
      : "";
    const rows = await supabaseRequest<Array<{ units: number }>>(
      `lead_provider_usage?select=units&provider=eq.${encodeURIComponent(name)}${filter}&success=eq.true&limit=10000`,
    );
    return rows.reduce((total, row) => total + Number(row.units || 0), 0);
  } catch {
    return 0;
  }
}

async function recordProviderUsage(provider: string, success: boolean, units = 1) {
  try {
    await supabaseRequest("lead_provider_usage", {
      method: "POST",
      body: JSON.stringify({
        provider,
        operation: provider === "hunter" ? "domain_search" : "search",
        units,
        success,
      }),
      prefer: "return=minimal",
    });
  } catch {
    // Provider calls still return while the optional usage migration is pending.
  }
}

function publicProviderStatus(run: ProviderRun) {
  return {
    name: run.name,
    status: run.status,
    used: run.used,
    limit: run.limit,
    error: run.error || null,
  };
}

function countryCode(location: string) {
  const normalized = location.toLowerCase();
  const matches: Record<string, string> = {
    "united states": "us",
    usa: "us",
    canada: "ca",
    "united kingdom": "gb",
    uk: "gb",
    australia: "au",
    philippines: "ph",
    singapore: "sg",
    india: "in",
  };
  return matches[normalized] || "us";
}

async function enrichWithHunter<T extends { website: string; emails: string[] }>(
  leads: T[],
) {
  const apiKey = process.env.HUNTER_API_KEY?.trim();
  if (!apiKey) return leads;
  const monthlyLimit = Math.max(
    1,
    Number(process.env.HUNTER_MONTHLY_LIMIT || "50"),
  );
  let used = await providerUsage("hunter", "monthly");
  const output = [...leads];
  for (let index = 0; index < output.length && index < 3; index += 1) {
    if (used >= monthlyLimit || output[index].emails.length) continue;
    try {
      const domain = new URL(output[index].website).hostname.replace(/^www\./, "");
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", domain);
      url.searchParams.set("limit", "5");
      const response = await fetch(url, {
        headers: { "X-API-KEY": apiKey },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: { emails?: Array<{ value?: string }> };
      };
      await recordProviderUsage("hunter", response.ok);
      used += response.ok ? 1 : 0;
      if (response.ok) {
        output[index] = {
          ...output[index],
          emails: [
            ...new Set([
              ...output[index].emails,
              ...(payload.data?.emails ?? [])
                .map((email) => email.value || "")
                .filter(Boolean),
            ]),
          ].slice(0, 5),
        };
      }
    } catch {
      await recordProviderUsage("hunter", false);
    }
  }
  return output;
}

type ProviderRun = {
  name: ProviderName;
  status: "used" | "exhausted" | "error";
  used: number;
  limit: number;
  results: TavilyResult[];
  error?: string;
};

class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

async function inspectWebsite(candidate: TavilyResult) {
  const startedAt = Date.now();
  const safeUrl = publicHttpUrl(candidate.url);
  if (!safeUrl) return unavailableLead(candidate, "unsafe_url");

  try {
    if (!(await allowedByRobots(safeUrl))) {
      return unavailableLead(candidate, "robots_blocked");
    }
    const response = await fetchWithTimeout(safeUrl.toString(), 8000);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return unavailableLead(candidate, `http_${response.status}`);
    }

    const html = (await response.text()).slice(0, 600_000);
    const finalUrl = publicHttpUrl(response.url) || safeUrl;
    const contactUrl = findContactUrl(html, finalUrl);
    let contactHtml = "";
    if (contactUrl && (await allowedByRobots(contactUrl))) {
      try {
        const contactResponse = await fetchWithTimeout(contactUrl.toString(), 6000);
        if (
          contactResponse.ok &&
          (contactResponse.headers.get("content-type") || "").includes("text/html")
        ) {
          contactHtml = (await contactResponse.text()).slice(0, 350_000);
        }
      } catch {
        // The homepage remains a valid lead when a contact page is unavailable.
      }
    }

    const allHtml = `${html}\n${contactHtml}`;
    return {
      id: crypto.randomUUID(),
      company_name:
        extractOrganizationName(html) ||
        cleanCompanyName(candidate.title) ||
        hostnameLabel(finalUrl.hostname),
      website: finalUrl.origin,
      source_url: candidate.url,
      description:
        extractMeta(html, "description") || clean(candidate.content, 360),
      location: "",
      emails: extractEmails(allHtml).slice(0, 5),
      phones: extractPhones(allHtml).slice(0, 3),
      linkedin_url: extractLinkedInCompanyUrl(allHtml),
      status: "live",
      status_code: response.status,
      secure: finalUrl.protocol === "https:",
      response_ms: Date.now() - startedAt,
    };
  } catch {
    return {
      ...unavailableLead(candidate, "unreachable"),
      response_ms: Date.now() - startedAt,
    };
  }
}

async function allowedByRobots(url: URL) {
  try {
    const response = await fetchWithTimeout(`${url.origin}/robots.txt`, 3500);
    if (!response.ok) return true;
    const text = (await response.text()).slice(0, 100_000);
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split("#")[0].trim();
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key?.toLowerCase() === "user-agent") {
        applies = value === "*";
      } else if (
        applies &&
        key?.toLowerCase() === "disallow" &&
        value &&
        url.pathname.startsWith(value)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

function uniqueWebsites(results: TavilyResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const url = publicHttpUrl(result.url);
    if (!url) return false;
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (
      EXCLUDED_HOSTS.some(
        (excluded) => hostname === excluded || hostname.endsWith(`.${excluded}`),
      ) ||
      seen.has(hostname)
    ) {
      return false;
    }
    seen.add(hostname);
    return true;
  });
}

function publicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, milliseconds: number) {
  let current = publicHttpUrl(url);
  if (!current) throw new Error("Unsafe website URL.");
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(milliseconds),
      headers: {
        "User-Agent":
          "RelayLeadResearch/1.0 (+https://relay-campaign-dashboard.vercel.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = publicHttpUrl(new URL(location, current).toString());
    if (!current) throw new Error("Website redirected to an unsafe URL.");
  }
  throw new Error("Website redirected too many times.");
}

function findContactUrl(html: string, base: URL) {
  const matches = html.matchAll(
    /href=["']([^"'#]*(?:contact|about|get-in-touch)[^"'#]*)["']/gi,
  );
  for (const match of matches) {
    try {
      const url = new URL(match[1], base);
      if (url.origin === base.origin && publicHttpUrl(url.toString())) return url;
    } catch {
      continue;
    }
  }
  return null;
}

function extractOrganizationName(html: string) {
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (
          item &&
          typeof item === "object" &&
          ["Organization", "LocalBusiness", "Corporation"].includes(
            String((item as Record<string, unknown>)["@type"]),
          )
        ) {
          const name = (item as Record<string, unknown>).name;
          if (typeof name === "string") return clean(name, 160);
        }
      }
    } catch {
      continue;
    }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? cleanCompanyName(decodeHtml(title)) : "";
}

function extractMeta(html: string, name: string) {
  const patterns = [
    new RegExp(
      `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return clean(decodeHtml(value), 360);
  }
  return "";
}

function extractEmails(html: string) {
  const decoded = decodeHtml(html);
  const matches =
    decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((email) => email.toLowerCase()))].filter(
    (email) =>
      !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email) &&
      !email.includes("example.com"),
  );
}

function extractPhones(html: string) {
  const text = decodeHtml(html.replace(/<[^>]+>/g, " "));
  const matches = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}/g) || [];
  return [...new Set(matches.map((phone) => phone.trim()))].filter(
    (phone) => phone.replace(/\D/g, "").length >= 7,
  );
}

function extractLinkedInCompanyUrl(html: string) {
  return (
    html.match(
      /https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9_%/?=&.-]+/i,
    )?.[0] || ""
  );
}

function unavailableLead(candidate: TavilyResult, status: string) {
  const url = publicHttpUrl(candidate.url);
  return {
    id: crypto.randomUUID(),
    company_name: cleanCompanyName(candidate.title) || hostnameLabel(url?.hostname || ""),
    website: url?.origin || candidate.url,
    source_url: candidate.url,
    description: clean(candidate.content, 360),
    location: "",
    emails: [],
    phones: [],
    linkedin_url: "",
    status,
    status_code: 0,
    secure: url?.protocol === "https:",
    response_ms: 0,
  };
}

function cleanCompanyName(value: string) {
  return clean(value.split(/\s+[|—–-]\s+/)[0], 160);
}

function hostnameLabel(hostname: string) {
  return hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clean(value: string | null | undefined, max: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  detail?: string;
  usage?: { credits?: number };
};
