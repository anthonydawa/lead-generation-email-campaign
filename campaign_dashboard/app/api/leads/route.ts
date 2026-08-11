import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      leads?: IncomingLead[];
      batch_label?: string;
    };
    const input = payload.leads ?? [];
    const batchLabel = clean(payload.batch_label);
    if (!input.length || input.length > 1000) {
      return NextResponse.json(
        { error: "Provide between 1 and 1,000 leads." },
        { status: 400 },
      );
    }

    const normalized = input.map((lead, index) => ({
      email: String(lead?.email || "").trim().toLowerCase(),
      first_name: clean(lead?.first_name),
      last_name: clean(lead?.last_name),
      company: clean(lead?.company),
      validation_status: importedValidationStatus(
        lead?.validation_status || lead?.email_status,
      ),
      status: "pending" as const,
      batch_label: batchLabel,
      source_row: index + 2,
    }));

    const invalid = normalized.find((lead) => !EMAIL_PATTERN.test(lead.email));
    if (invalid) {
      return NextResponse.json(
        {
          error: `CSV row ${invalid.source_row} has an invalid or missing email address: ${invalid.email || "(blank)"}`,
        },
        { status: 400 },
      );
    }

    const records: LeadRecord[] = normalized.map((lead) => ({
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company: lead.company,
      validation_status: lead.validation_status,
      status: lead.status,
      batch_label: lead.batch_label,
    }));
    const inserted = await insertLeadsSkippingDuplicates(records);

    const verifiedEmails = normalized
      .filter((lead) => lead.validation_status === "valid")
      .map((lead) => encodeURIComponent(lead.email));
    if (verifiedEmails.length) {
      await supabaseRequest(`leads?email=in.(${verifiedEmails.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ validation_status: "valid" }),
        prefer: "return=minimal",
      });
    }

    return NextResponse.json({
      inserted,
      skipped: normalized.length - inserted,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to import leads" },
      { status: 500 },
    );
  }
}

async function insertLeadsSkippingDuplicates(
  records: LeadRecord[],
): Promise<number> {
  if (!records.length) return 0;
  try {
    const inserted = await supabaseRequest<unknown[]>("leads", {
      method: "POST",
      body: JSON.stringify(records),
      prefer: "return=representation",
    });
    return inserted.length;
  } catch (error) {
    if (!isDuplicateEmailError(error)) throw error;
    if (records.length === 1) return 0;

    const midpoint = Math.ceil(records.length / 2);
    const firstHalf = await insertLeadsSkippingDuplicates(
      records.slice(0, midpoint),
    );
    const secondHalf = await insertLeadsSkippingDuplicates(
      records.slice(midpoint),
    );
    return firstHalf + secondHalf;
  }
}

function isDuplicateEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("leads_email_lower_unique") ||
    (message.includes("23505") && message.includes("lower(email)"))
  );
}

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized || null;
}

type IncomingLead = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  validation_status?: string | null;
  email_status?: string | null;
};

type LeadRecord = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  validation_status: string;
  status: "pending";
  batch_label: string | null;
};

function importedValidationStatus(value?: string | null) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (status === "verified") return "valid";
  if (["invalid", "undeliverable", "bounced"].includes(status)) return "invalid";
  if (status === "disposable") return "disposable";
  return "unvalidated";
}
