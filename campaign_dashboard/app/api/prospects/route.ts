import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prospects = await supabaseRequest<Prospect[]>(
      "linkedin_prospects?select=id,source_member_id,full_name,first_name,last_name,headline,job_title,company,industry,location,profile_url,source,saved_at&order=saved_at.desc&limit=500",
    );
    return NextResponse.json({ prospects });
  } catch (error) {
    return NextResponse.json(
      {
        prospects: [],
        setup_required: true,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load saved prospects.",
      },
      { status: 200 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { prospect?: IncomingProspect };
    const prospect = payload.prospect;
    if (!prospect?.source_member_id || !prospect.full_name) {
      return NextResponse.json(
        { error: "A source member ID and full name are required." },
        { status: 400 },
      );
    }

    const saved = await supabaseRequest<Prospect[]>("linkedin_prospects", {
      method: "POST",
      body: JSON.stringify({
        source_member_id: clean(prospect.source_member_id, 200),
        full_name: clean(prospect.full_name),
        first_name: cleanNullable(prospect.first_name),
        last_name: cleanNullable(prospect.last_name),
        headline: cleanNullable(prospect.headline),
        job_title: cleanNullable(prospect.job_title),
        company: cleanNullable(prospect.company),
        industry: cleanNullable(prospect.industry),
        location: cleanNullable(prospect.location),
        profile_url: allowedProfileUrl(prospect.profile_url),
        source: "linkedin",
        raw_data: null,
      }),
      prefer: "resolution=merge-duplicates,return=representation",
    });

    return NextResponse.json({ prospect: saved[0] }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const setupRequired = detail.includes("linkedin_prospects");
    return NextResponse.json(
      {
        error: setupRequired
          ? "Prospect storage is not ready. Apply the included Supabase migration first."
          : detail || "Unable to save this prospect.",
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Choose a saved prospect to remove." },
        { status: 400 },
      );
    }
    await supabaseRequest(`linkedin_prospects?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to remove prospect.",
      },
      { status: 500 },
    );
  }
}

type IncomingProspect = {
  source_member_id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  job_title?: string;
  company?: string;
  industry?: string;
  location?: string;
  profile_url?: string;
};

type Prospect = IncomingProspect & {
  id: string;
  source: string;
  saved_at: string;
};

function clean(value: string, max = 300) {
  return value.trim().slice(0, max);
}

function cleanNullable(value?: string) {
  const normalized = value?.trim().slice(0, 300);
  return normalized || null;
}

function allowedProfileUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith("linkedin.com")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
