import { NextRequest, NextResponse } from "next/server";
import {
  EMAIL_PATTERN,
  isThirdPartyEmailVerified,
} from "../../lib/lead-import-validation";
import {
  insertLeadsSkippingDuplicates,
  type LeadInsertRecord,
} from "../../lib/lead-insert";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      leads?: IncomingLead[];
      batch_label?: string;
    };
    const input = payload.leads ?? [];
    const batchLabel = clean(payload.batch_label);
    if (!input.length || input.length > 5000) {
      return NextResponse.json(
        { error: "Provide between 1 and 5,000 leads." },
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
      third_party_email_verified: clean(lead?.third_party_email_verified),
      status: "pending" as const,
      batch_label: batchLabel,
      source_row: index + 2,
    }));

    const verified = normalized.filter(
      (lead) =>
        EMAIL_PATTERN.test(lead.email) &&
        isThirdPartyEmailVerified(
          lead.validation_status,
          lead.third_party_email_verified,
        ),
    );
    const rejectedInvalid = normalized.filter(
      (lead) => !EMAIL_PATTERN.test(lead.email),
    ).length;
    const rejectedUnverified = normalized.length - verified.length - rejectedInvalid;

    const records: LeadInsertRecord[] = verified.map((lead) => ({
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company: lead.company,
      validation_status: lead.validation_status,
      status: lead.status,
      batch_label: lead.batch_label,
    }));
    const inserted = (await insertLeadsSkippingDuplicates(records)).length;

    return NextResponse.json({
      inserted,
      skipped: normalized.length - inserted,
      skipped_duplicates: verified.length - inserted,
      rejected_unverified: rejectedUnverified,
      rejected_invalid: rejectedInvalid,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to import leads" },
      { status: 500 },
    );
  }
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
  third_party_email_verified?: string | null;
};

function importedValidationStatus(value?: string | null) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (isThirdPartyEmailVerified(status)) return "valid";
  if (["invalid", "undeliverable", "bounced"].includes(status)) return "invalid";
  if (status === "disposable") return "disposable";
  return "unvalidated";
}
