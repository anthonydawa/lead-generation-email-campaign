import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../../lib/supabase-admin";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as SavePayload;
    const query = clean(payload.query, 160);
    const location = clean(payload.location, 100);
    const results = (payload.results ?? []).slice(0, 50);
    if (!query || !results.length) {
      return NextResponse.json(
        { error: "Run a search before saving it." },
        { status: 400 },
      );
    }

    const searches = await supabaseRequest<Array<{ id: string }>>("lead_searches", {
      method: "POST",
      body: JSON.stringify({
        query,
        location: location || null,
        provider: payload.provider || "tavily",
        result_count: results.length,
      }),
      prefer: "return=representation",
    });
    const searchId = searches[0]?.id;
    if (!searchId) throw new Error("The saved search did not return an ID.");

    const saved = await supabaseRequest<Array<{ id: string }>>("web_prospects", {
      method: "POST",
      body: JSON.stringify(
        results.map((lead) => ({
          website: normalizeWebsite(lead.website),
          company_name: clean(lead.company_name, 160),
          description: clean(lead.description, 500) || null,
          location: clean(lead.location, 160) || location || null,
          public_emails: lead.emails?.slice(0, 10) ?? [],
          public_phones: lead.phones?.slice(0, 10) ?? [],
          linkedin_url: clean(lead.linkedin_url, 500) || null,
          source_url: clean(lead.source_url, 1000) || null,
          website_status: clean(lead.status, 40) || "unknown",
          website_status_code: Number(lead.status_code || 0),
          website_secure: Boolean(lead.secure),
          last_search_id: searchId,
          last_checked_at: new Date().toISOString(),
        })),
      ),
      prefer: "resolution=merge-duplicates,return=representation",
    });

    return NextResponse.json({
      search_id: searchId,
      saved: saved.length,
      results: results.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save this search.";
    const setupRequired =
      message.includes("lead_searches") || message.includes("web_prospects");
    return NextResponse.json(
      {
        error: setupRequired
          ? "Web lead storage is not ready. Run the included Supabase web-leads migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

function normalizeWebsite(value: string) {
  const url = new URL(value);
  return url.origin.toLowerCase();
}

function clean(value: string | null | undefined, max: number) {
  return String(value || "").trim().slice(0, max);
}

type SavePayload = {
  query?: string;
  location?: string;
  provider?: string;
  results?: Array<{
    company_name: string;
    website: string;
    source_url: string;
    description: string;
    location: string;
    emails: string[];
    phones: string[];
    linkedin_url: string;
    status: string;
    status_code: number;
    secure: boolean;
  }>;
};
