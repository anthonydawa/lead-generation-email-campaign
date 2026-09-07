import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";
import { ensureDefaultEmailFooter } from "../../lib/email-content";

export async function POST(request: NextRequest) {
  let campaignId: string | null = null;
  try {
    const payload = (await request.json()) as CampaignInput;
    const title = payload.title?.trim();
    const subject = payload.subject_template?.trim();
    const bodyDraft = payload.body_template?.trim();
    const body = bodyDraft ? ensureDefaultEmailFooter(bodyDraft) : "";
    const leadIds = [...new Set(payload.lead_ids ?? [])];
    const initialSendAt = payload.initial_send_at?.trim();
    const timezone = payload.timezone?.trim() || "UTC";
    const senderEmail = payload.sender_email?.trim().toLowerCase() || null;
    const messageTemplateId = payload.message_template_id?.trim() || null;
    const followups = [...(payload.followups ?? [])]
      .map((step) => ({
        delay_days: Number(step.delay_days),
        body_template: step.body_template?.trim()
          ? ensureDefaultEmailFooter(step.body_template)
          : "",
      }))
      .sort((a, b) => a.delay_days - b.delay_days);

    if (!title || !subject || !body) {
      return NextResponse.json(
        { error: "Title, subject, and email body are required." },
        { status: 400 },
      );
    }
    if (!leadIds.length) {
      return NextResponse.json(
        { error: "Select at least one recipient." },
        { status: 400 },
      );
    }
    if (!initialSendAt || Number.isNaN(Date.parse(initialSendAt))) {
      return NextResponse.json(
        { error: "Choose a valid initial send date and time." },
        { status: 400 },
      );
    }
    const delays = followups.map((step) => step.delay_days);
    if (
      followups.some(
        (step) =>
          !Number.isInteger(step.delay_days) ||
          step.delay_days < 1 ||
          step.delay_days > 365 ||
          !step.body_template,
      ) ||
      new Set(delays).size !== delays.length
    ) {
      return NextResponse.json(
        {
          error:
            "Each follow-up needs a message and a unique delay from 1 to 365 days.",
        },
        { status: 400 },
      );
    }

    const campaigns = await supabaseRequest<Array<{ id: string }>>("campaigns", {
      method: "POST",
      body: JSON.stringify({
        title,
        subject_template: subject,
        body_template: body,
        initial_send_at: new Date(initialSendAt).toISOString(),
        timezone,
        sender_email: senderEmail,
        message_template_id: messageTemplateId,
        status: "staged",
      }),
      prefer: "return=representation",
    });
    campaignId = campaigns[0]?.id ?? null;
    if (!campaignId) throw new Error("Campaign was created without an ID.");

    if (followups.length) {
      await supabaseRequest("campaign_steps", {
        method: "POST",
        body: JSON.stringify(
          followups.map((step, index) => ({
            campaign_id: campaignId,
            step_number: index + 1,
            delay_days: step.delay_days,
            body_template: step.body_template,
          })),
        ),
        prefer: "return=minimal",
      });
    }

    await supabaseRequest("campaign_leads", {
      method: "POST",
      body: JSON.stringify(
        leadIds.map((leadId) => ({
          campaign_id: campaignId,
          lead_id: leadId,
          status: "pending",
        })),
      ),
      prefer: "return=minimal",
    });

    return NextResponse.json({ id: campaignId }, { status: 201 });
  } catch (error) {
    if (campaignId) {
      try {
        await supabaseRequest(`campaigns?id=eq.${encodeURIComponent(campaignId)}`, {
          method: "DELETE",
          prefer: "return=minimal",
        });
      } catch {
        // Preserve the original error; the orphan is visible in the dashboard.
      }
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create the campaign",
      },
      { status: 500 },
    );
  }
}

type CampaignInput = {
  title?: string;
  subject_template?: string;
  body_template?: string;
  initial_send_at?: string;
  timezone?: string;
  sender_email?: string;
  message_template_id?: string;
  followups?: Array<{
    delay_days?: number;
    body_template?: string;
  }>;
  lead_ids?: string[];
};
