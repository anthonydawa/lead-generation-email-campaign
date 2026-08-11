import { NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [leads, campaigns, logs, templates] = await Promise.all([
      supabaseRequest<Lead[]>(
        "leads?select=id,email,first_name,last_name,company,validation_status,status,batch_label,created_at&order=created_at.desc&limit=500",
      ),
      supabaseRequest<Campaign[]>(
        "campaigns?select=id,title,subject_template,body_template,message_template_id,initial_send_at,timezone,sender_email,status,created_at&order=created_at.desc&limit=100",
      ),
      supabaseRequest<CampaignLog[]>(
        "campaign_logs?select=id,campaign_id,lead_id,status,step_number,sent_at&order=sent_at.desc&limit=1000",
      ),
      supabaseRequest<MessageTemplate[]>(
        "message_templates?select=id,name,subject_template,body_template,followups,created_at,updated_at&order=updated_at.desc&limit=100",
      ),
    ]);

    let assignments: CampaignLead[] = [];
    let steps: CampaignStep[] = [];
    [assignments, steps] = await Promise.all([
      supabaseRequest<CampaignLead[]>(
        "campaign_leads?select=campaign_id,lead_id,status,current_step,next_send_at,created_at&limit=5000",
      ),
      supabaseRequest<CampaignStep[]>(
        "campaign_steps?select=id,campaign_id,step_number,delay_days,body_template&order=step_number&limit=1000",
      ),
    ]);

    return NextResponse.json({ leads, campaigns, logs, assignments, steps, templates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load dashboard" },
      { status: 500 },
    );
  }
}

type Lead = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  validation_status: string;
  status: string;
  batch_label: string | null;
  created_at: string;
};

type Campaign = {
  id: string;
  title: string;
  subject_template: string;
  body_template: string;
  message_template_id: string | null;
  initial_send_at: string | null;
  timezone: string;
  sender_email: string | null;
  status: string;
  step_number: number;
  created_at: string;
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

type CampaignLog = {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: string;
  sent_at: string;
};

type CampaignLead = {
  campaign_id: string;
  lead_id: string;
  status: string;
  current_step: number;
  next_send_at: string | null;
  created_at: string;
};

type CampaignStep = {
  id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  body_template: string;
};
