import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../../lib/supabase-admin";

export async function POST(request: NextRequest) {
  try {
    const research = (await request.json()) as ResearchPayload;
    const website = normalizeWebsite(research.website || "");
    if (!website || !research.company_name) {
      return NextResponse.json({ error: "Research a company before saving it." }, { status: 400 });
    }

    const saved = await supabaseRequest<Array<{ id: string }>>(
      "company_research?on_conflict=website",
      {
        method: "POST",
        body: JSON.stringify({
          website,
          company_name: clean(research.company_name, 160),
          summary: clean(research.summary, 1200) || null,
          industry: clean(research.industry, 160) || null,
          services: research.services?.slice(0, 12) || [],
          target_customers: research.target_customers?.slice(0, 10) || [],
          locations: research.locations?.slice(0, 10) || [],
          people: research.people?.slice(0, 20) || [],
          public_emails: research.emails?.slice(0, 20) || [],
          public_phones: research.phones?.slice(0, 20) || [],
          linkedin_url: clean(research.linkedin_url, 1000) || null,
          outreach_angle: clean(research.outreach_angle, 1000) || null,
          qualification_score: Math.min(
            100,
            Math.max(0, Number(research.qualification_score || 0)),
          ),
          qualification_reason:
            clean(research.qualification_reason, 1000) || null,
          sources: research.pages?.slice(0, 12) || [],
          ai_provider: clean(research.ai_provider, 80) || "rules-only",
          ai_model: clean(research.ai_model, 160) || null,
          researched_at: research.researched_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    return NextResponse.json({ saved: true, id: saved[0]?.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save company research.";
    const setupRequired = message.includes("company_research");
    return NextResponse.json(
      {
        error: setupRequired
          ? "Research storage is not ready. Run the updated Supabase web-leads migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

function normalizeWebsite(value: string) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

function clean(value: string | null | undefined, max: number) {
  return String(value || "").trim().slice(0, max);
}

type ResearchPayload = {
  website?: string;
  company_name?: string;
  summary?: string;
  industry?: string;
  services?: string[];
  target_customers?: string[];
  locations?: string[];
  people?: Array<{ name: string; role: string; source_url: string }>;
  emails?: string[];
  phones?: string[];
  linkedin_url?: string;
  outreach_angle?: string;
  qualification_score?: number;
  qualification_reason?: string;
  pages?: Array<{ type: string; title: string; url: string }>;
  ai_provider?: string;
  ai_model?: string;
  researched_at?: string;
};
