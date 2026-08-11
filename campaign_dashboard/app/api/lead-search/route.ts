import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchFilters = {
  keywords: string;
  role: string;
  industry: string;
  location: string;
  company: string;
};

type Prospect = {
  source_member_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  headline: string;
  job_title: string;
  company: string;
  industry: string;
  location: string;
  profile_url: string;
  source: "linkedin";
};

const DEMO_PROSPECTS: Prospect[] = [
  {
    source_member_id: "demo-maya-chen",
    full_name: "Maya Chen",
    first_name: "Maya",
    last_name: "Chen",
    headline: "VP of Revenue Operations at Northstar Labs",
    job_title: "VP of Revenue Operations",
    company: "Northstar Labs",
    industry: "Software",
    location: "San Francisco Bay Area",
    profile_url: "",
    source: "linkedin",
  },
  {
    source_member_id: "demo-daniel-ortiz",
    full_name: "Daniel Ortiz",
    first_name: "Daniel",
    last_name: "Ortiz",
    headline: "Head of Growth at Ledgerly",
    job_title: "Head of Growth",
    company: "Ledgerly",
    industry: "Financial Services",
    location: "Austin, Texas",
    profile_url: "",
    source: "linkedin",
  },
  {
    source_member_id: "demo-priya-shah",
    full_name: "Priya Shah",
    first_name: "Priya",
    last_name: "Shah",
    headline: "Director of Partnerships at Arc & Co.",
    job_title: "Director of Partnerships",
    company: "Arc & Co.",
    industry: "Marketing & Advertising",
    location: "New York City",
    profile_url: "",
    source: "linkedin",
  },
  {
    source_member_id: "demo-jordan-kim",
    full_name: "Jordan Kim",
    first_name: "Jordan",
    last_name: "Kim",
    headline: "Founder & CEO at Fieldwork",
    job_title: "Founder & CEO",
    company: "Fieldwork",
    industry: "Business Consulting",
    location: "Singapore",
    profile_url: "",
    source: "linkedin",
  },
  {
    source_member_id: "demo-elena-rossi",
    full_name: "Elena Rossi",
    first_name: "Elena",
    last_name: "Rossi",
    headline: "People Operations Lead at Brightside",
    job_title: "People Operations Lead",
    company: "Brightside",
    industry: "Information Technology",
    location: "London, United Kingdom",
    profile_url: "",
    source: "linkedin",
  },
  {
    source_member_id: "demo-noah-williams",
    full_name: "Noah Williams",
    first_name: "Noah",
    last_name: "Williams",
    headline: "Chief Marketing Officer at Juniper Works",
    job_title: "Chief Marketing Officer",
    company: "Juniper Works",
    industry: "Consumer Services",
    location: "Toronto, Canada",
    profile_url: "",
    source: "linkedin",
  },
];

export async function GET(request: NextRequest) {
  const filters: SearchFilters = {
    keywords: clean(request.nextUrl.searchParams.get("keywords")),
    role: clean(request.nextUrl.searchParams.get("role")),
    industry: clean(request.nextUrl.searchParams.get("industry")),
    location: clean(request.nextUrl.searchParams.get("location")),
    company: clean(request.nextUrl.searchParams.get("company")),
  };

  const endpoint = process.env.LINKEDIN_APPROVED_SEARCH_ENDPOINT;
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const dailyLimit = Math.max(
    1,
    Number(process.env.LINKEDIN_DAILY_LIMIT || "100"),
  );
  const used = await getTodayUsage();

  if (!endpoint || !token) {
    return NextResponse.json({
      mode: "demo",
      results: filterDemoResults(filters),
      usage: { used, limit: dailyLimit, resets_at: nextUtcMidnight() },
      notice:
        "Demo data is active. Connect only an approved LinkedIn search product to enable live results.",
    });
  }

  if (used >= dailyLimit) {
    return NextResponse.json(
      {
        error: "The configured daily LinkedIn request limit has been reached.",
        usage: { used, limit: dailyLimit, resets_at: nextUtcMidnight() },
      },
      { status: 429 },
    );
  }

  try {
    const providerUrl = new URL(endpoint);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) providerUrl.searchParams.set(key, value);
    });

    const response = await fetch(providerUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || "202607",
      },
      cache: "no-store",
    });
    await recordUsage(response.status);

    if (!response.ok) {
      const message =
        response.status === 429
          ? "LinkedIn has rate-limited this workspace. Try again after the provider reset."
          : "The approved LinkedIn provider could not complete this search.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const payload = (await response.json()) as { results?: Prospect[] };
    return NextResponse.json({
      mode: "live",
      results: (payload.results ?? []).map(normalizeProspect),
      usage: {
        used: used + 1,
        limit: dailyLimit,
        resets_at: nextUtcMidnight(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to search the approved LinkedIn provider.",
      },
      { status: 502 },
    );
  }
}

function filterDemoResults(filters: SearchFilters) {
  const terms = Object.values(filters)
    .filter(Boolean)
    .flatMap((value) => value.toLowerCase().split(/\s+/));
  if (!terms.length) return DEMO_PROSPECTS;
  const matches = DEMO_PROSPECTS.filter((prospect) => {
    const haystack = Object.values(prospect).join(" ").toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
  return matches.length ? matches : DEMO_PROSPECTS.slice(0, 3);
}

function normalizeProspect(input: Prospect): Prospect {
  return {
    source_member_id: String(input.source_member_id || "").slice(0, 200),
    full_name: clean(input.full_name),
    first_name: clean(input.first_name),
    last_name: clean(input.last_name),
    headline: clean(input.headline),
    job_title: clean(input.job_title),
    company: clean(input.company),
    industry: clean(input.industry),
    location: clean(input.location),
    profile_url: clean(input.profile_url),
    source: "linkedin",
  };
}

async function getTodayUsage() {
  try {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await supabaseRequest<Array<{ id: string }>>(
      `linkedin_api_usage?select=id&called_at=gte.${encodeURIComponent(start.toISOString())}&limit=5000`,
    );
    return rows.length;
  } catch {
    return 0;
  }
}

async function recordUsage(statusCode: number) {
  try {
    await supabaseRequest("linkedin_api_usage", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "approved_search",
        status_code: statusCode,
      }),
      prefer: "return=minimal",
    });
  } catch {
    // Search should remain available while the optional usage migration is pending.
  }
}

function nextUtcMidnight() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function clean(value: string | null | undefined) {
  return String(value || "").trim().slice(0, 300);
}
