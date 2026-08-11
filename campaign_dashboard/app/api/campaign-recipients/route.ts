import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  try {
    const input = (await request.json()) as {
      campaign_id?: string;
      lead_id?: string;
    };
    const campaignId = input.campaign_id?.trim() || "";
    const leadId = input.lead_id?.trim() || "";
    if (!UUID_PATTERN.test(campaignId) || !UUID_PATTERN.test(leadId)) {
      return NextResponse.json(
        { error: "A valid campaign and recipient are required." },
        { status: 400 },
      );
    }

    const assignmentPath =
      `campaign_leads?campaign_id=eq.${encodeURIComponent(campaignId)}` +
      `&lead_id=eq.${encodeURIComponent(leadId)}`;
    const updated = await supabaseRequest<Array<{ status: string }>>(
      `${assignmentPath}&status=in.(pending,sent)`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "skipped", next_send_at: null }),
        headers: { Prefer: "return=representation" },
      },
    );
    if (updated.length) {
      return NextResponse.json({ changed: true, status: "skipped" });
    }

    const current = await supabaseRequest<Array<{ status: string }>>(
      `${assignmentPath}&select=status&limit=1`,
    );
    if (!current.length) {
      return NextResponse.json(
        { error: "That campaign recipient no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ changed: false, status: current[0].status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to remove the campaign recipient.",
      },
      { status: 500 },
    );
  }
}
