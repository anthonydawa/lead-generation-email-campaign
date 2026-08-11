import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await supabaseRequest<SavedCandidateRow[]>(
      "contact_candidates?select=id,website,company_name,person_name,role,person_source_url,email,origin,verification_status,confidence,verification_provider,verification_reason,mx_found,catch_all,disposable,role_address,evidence_urls,verification_details,campaign_eligible,approved,approved_at,lead_id,created_at,updated_at&approved=eq.false&order=updated_at.desc&limit=500",
    );
    return NextResponse.json({
      candidates: rows.map((row) => ({
        id: row.id,
        website: row.website,
        company_name: row.company_name,
        person_name: row.person_name,
        role: row.role,
        person_source_url: row.person_source_url,
        email: row.email,
        origin: row.origin,
        status: row.verification_status,
        confidence: row.confidence,
        provider: row.verification_provider,
        reason: row.verification_reason || "Saved for verification review.",
        mx_found: row.mx_found,
        catch_all: row.catch_all,
        disposable: row.disposable,
        role_address: row.role_address,
        evidence_urls: row.evidence_urls,
        verification_details: row.verification_details,
        campaign_eligible: row.campaign_eligible,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load contact candidates.";
    const setupRequired = message.includes("contact_candidates");
    return NextResponse.json(
      {
        candidates: [],
        error: setupRequired
          ? "Contact storage is not ready. Run the updated Supabase web-leads migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 200 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as CandidateInput;
    const action = input.action === "approve" ? "approve" : "save";
    const email = String(input.email || "").trim().toLowerCase();
    const website = normalizeWebsite(input.website || "");
    const eligible =
      input.status === "deliverable" &&
      !input.catch_all &&
      !input.disposable &&
      !input.role_address;
    if (!EMAIL_RE.test(email) || !website || !input.person_name) {
      return NextResponse.json({ error: "The contact candidate is incomplete." }, { status: 400 });
    }
    if (email.split("@")[1] !== new URL(website).hostname.replace(/^www\./, "")) {
      return NextResponse.json(
        { error: "The candidate email must use the researched company domain." },
        { status: 400 },
      );
    }
    if (action === "approve" && !eligible) {
      return NextResponse.json(
        { error: "Only deliverable, non-catch-all personal addresses can be approved." },
        { status: 400 },
      );
    }

    const name = splitName(input.person_name);
    const saved = await supabaseRequest<Array<{ id: string }>>(
      "contact_candidates?on_conflict=website,person_name,email",
      {
        method: "POST",
        body: JSON.stringify({
          website,
          company_name: clean(input.company_name, 160),
          person_name: clean(input.person_name, 160),
          first_name: name.first || null,
          last_name: name.last || null,
          role: clean(input.role, 160) || null,
          person_source_url: clean(input.person_source_url, 1000),
          email,
          origin: clean(input.origin, 40) || "inferred",
          verification_status: clean(input.status, 40) || "unknown",
          confidence: Math.min(100, Math.max(0, Number(input.confidence || 0))),
          verification_provider: clean(input.provider, 80) || "local",
          verification_reason: clean(input.reason, 500) || null,
          mx_found: Boolean(input.mx_found),
          catch_all: Boolean(input.catch_all),
          disposable: Boolean(input.disposable),
          role_address: Boolean(input.role_address),
          evidence_urls: input.evidence_urls?.slice(0, 12) || [],
          verification_details: input.verification_details || {},
          campaign_eligible: eligible,
          approved: action === "approve",
          approved_at: action === "approve" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }),
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    const candidateId = saved[0]?.id;
    let leadId: string | null = null;

    if (action === "approve") {
      const existing = await supabaseRequest<Array<{ id: string }>>(
        `leads?select=id&email=ilike.${encodeURIComponent(email)}&limit=1`,
      );
      if (existing[0]?.id) {
        leadId = existing[0].id;
        await supabaseRequest(`leads?id=eq.${encodeURIComponent(leadId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            first_name: name.first || null,
            last_name: name.last || null,
            company: clean(input.company_name, 160) || null,
            validation_status: "valid",
          }),
          prefer: "return=minimal",
        });
      } else {
        const leads = await supabaseRequest<Array<{ id: string }>>("leads", {
          method: "POST",
          body: JSON.stringify({
            email,
            first_name: name.first || null,
            last_name: name.last || null,
            company: clean(input.company_name, 160) || null,
            validation_status: "valid",
            status: "pending",
          }),
          prefer: "return=representation",
        });
        leadId = leads[0]?.id || null;
      }
      if (candidateId && leadId) {
        await supabaseRequest(
          `contact_candidates?id=eq.${encodeURIComponent(candidateId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ lead_id: leadId }),
            prefer: "return=minimal",
          },
        );
      }
    }

    return NextResponse.json({
      saved: true,
      approved: action === "approve",
      candidate_id: candidateId,
      lead_id: leadId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save this contact candidate.";
    const setupRequired = message.includes("contact_candidates");
    return NextResponse.json(
      {
        error: setupRequired
          ? "Contact storage is not ready. Run the updated Supabase web-leads migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeWebsite(value: string) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

function clean(value: string | null | undefined, max: number) {
  return String(value || "").trim().slice(0, max);
}

type CandidateInput = {
  action?: "save" | "approve";
  website?: string;
  company_name?: string;
  person_name?: string;
  role?: string;
  person_source_url?: string;
  email?: string;
  origin?: string;
  status?: string;
  confidence?: number;
  provider?: string;
  reason?: string;
  mx_found?: boolean;
  catch_all?: boolean;
  disposable?: boolean;
  role_address?: boolean;
  evidence_urls?: string[];
  verification_details?: unknown;
};

type SavedCandidateRow = {
  id: string;
  website: string;
  company_name: string;
  person_name: string;
  role: string | null;
  person_source_url: string;
  email: string;
  origin: string;
  verification_status: string;
  confidence: number;
  verification_provider: string;
  verification_reason: string | null;
  mx_found: boolean;
  catch_all: boolean;
  disposable: boolean;
  role_address: boolean;
  evidence_urls: string[];
  verification_details: unknown;
  campaign_eligible: boolean;
  approved: boolean;
  approved_at: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
};
