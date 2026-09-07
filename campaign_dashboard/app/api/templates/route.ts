import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";
import { ensureDefaultEmailFooter } from "../../lib/email-content";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as TemplateInput;
    const name = input.name?.trim();
    const subject = input.subject_template?.trim();
    const bodyDraft = input.body_template?.trim();
    const body = bodyDraft ? ensureDefaultEmailFooter(bodyDraft) : "";
    const followups = (input.followups || []).map((step) => ({
      delay_days: Number(step.delay_days),
      body_template: step.body_template?.trim()
        ? ensureDefaultEmailFooter(step.body_template)
        : "",
    }));

    if (!name || !subject || !body) {
      return NextResponse.json(
        { error: "Template name, subject, and message are required." },
        { status: 400 },
      );
    }
    if (
      followups.some(
        (step) =>
          !Number.isInteger(step.delay_days) ||
          step.delay_days < 1 ||
          step.delay_days > 365 ||
          !step.body_template,
      )
    ) {
      return NextResponse.json(
        { error: "Each follow-up needs a message and delay from 1 to 365 days." },
        { status: 400 },
      );
    }

    const saved = await supabaseRequest<MessageTemplate[]>("message_templates", {
      method: "POST",
      body: JSON.stringify({
        name,
        subject_template: subject,
        body_template: body,
        followups,
      }),
      prefer: "return=representation",
    });
    return NextResponse.json(saved[0], { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save template.",
      },
      { status: 500 },
    );
  }
}

type TemplateInput = {
  name?: string;
  subject_template?: string;
  body_template?: string;
  followups?: Array<{ delay_days?: number; body_template?: string }>;
};

type MessageTemplate = {
  id: string;
  name: string;
  subject_template: string;
  body_template: string;
  followups: Array<{ delay_days: number; body_template: string }>;
  created_at: string;
  updated_at: string;
};
