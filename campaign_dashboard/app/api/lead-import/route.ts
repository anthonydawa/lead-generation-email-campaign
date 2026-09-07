import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "../../lib/supabase-admin";
import {
  EMAIL_PATTERN,
  isThirdPartyEmailVerified,
} from "../../lib/lead-import-validation";
import {
  insertLeadsSkippingDuplicates,
  type LeadInsertRecord,
} from "../../lib/lead-insert";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prospects = await supabaseRequest<ImportedProspect[]>(
      "imported_prospects?select=*&order=created_at.desc&limit=100",
    );
    return NextResponse.json({ prospects });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load imported leads.";
    const setupRequired = message.includes("imported_prospects");
    return NextResponse.json(
      {
        prospects: [],
        error: setupRequired
          ? "Spreadsheet import storage is not ready. Run the updated Supabase migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as ImportInput;
    const rows = (input.rows || []).slice(0, 5000);
    if (!rows.length) {
      return NextResponse.json(
        { error: "Choose at least one spreadsheet row to import." },
        { status: 400 },
      );
    }

    const normalized = rows.map((row, index) => normalizeRow(row, index + 1));
    const structurallyValid = normalized.filter(
      (row) =>
        row.company_name &&
        row.company_website &&
        row.contact_name &&
        row.contact_name.trim().split(/\s+/).length > 1 &&
        Boolean(row.business_email),
    );
    const verifiedCandidates = structurallyValid.filter((row) =>
      isThirdPartyEmailVerified(
        row.email_status,
        row.third_party_email_verified,
      ),
    );
    const rejectedInvalid = rows.length - structurallyValid.length;
    const rejectedUnverified = structurallyValid.length - verifiedCandidates.length;
    const batchLabel =
      clean(input.batch_label, 120) ||
      clean(input.source_file, 255) ||
      "Uploaded spreadsheet";
    const batches = await supabaseRequest<Array<{ id: string }>>(
      "lead_import_batches",
      {
        method: "POST",
        body: JSON.stringify({
          source_file: clean(input.source_file, 255) || "uploaded-spreadsheet.csv",
          label: batchLabel,
          total_rows: rows.length,
          imported_rows: 0,
        }),
        prefer: "return=representation",
      },
    );
    const batchId = batches[0]?.id;
    if (!batchId) throw new Error("Unable to create the import batch.");

    const contactImport = await promoteEmailContacts(
      verifiedCandidates,
      batchLabel,
    );
    const insertedEmails = new Set(
      contactImport.inserted.map((contact) => contact.email.toLowerCase()),
    );
    const acceptedEmails = new Set<string>();
    const acceptedRows = verifiedCandidates.filter((row) => {
      const email = String(row.business_email || "").toLowerCase();
      if (!insertedEmails.has(email) || acceptedEmails.has(email)) return false;
      acceptedEmails.add(email);
      return true;
    });
    await supabaseRequest(
      `lead_import_batches?id=eq.${encodeURIComponent(batchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ imported_rows: acceptedRows.length }),
        prefer: "return=minimal",
      },
    );

    const saved = acceptedRows.length
      ? await supabaseRequest<ImportedProspect[]>(
          "imported_prospects?on_conflict=company_website,contact_name",
          {
            method: "POST",
            body: JSON.stringify(
              acceptedRows.map((row) => ({
                ...stripImportOnlyFields(row),
                import_batch_id: batchId,
                source_file:
                  clean(input.source_file, 255) || "uploaded-spreadsheet.csv",
                batch_label: batchLabel,
                updated_at: new Date().toISOString(),
              })),
            ),
            prefer: "resolution=merge-duplicates,return=representation",
          },
        )
      : [];
    const skippedDuplicates = verifiedCandidates.length - acceptedRows.length;

    return NextResponse.json({
      batch_id: batchId,
      imported: saved.length,
      skipped: rows.length - acceptedRows.length,
      skipped_duplicates: skippedDuplicates,
      rejected_unverified: rejectedUnverified,
      rejected_invalid: rejectedInvalid,
      prospects: saved,
      email_contacts: acceptedRows.length,
      verified_contacts: acceptedRows.length,
      queued_for_validation: 0,
      queued_for_find_email: 0,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to import spreadsheet leads.";
    const setupRequired =
      message.includes("imported_prospects") ||
      message.includes("lead_import_batches");
    return NextResponse.json(
      {
        error: setupRequired
          ? "Spreadsheet import storage is not ready. Run the updated Supabase migration."
          : message,
        setup_required: setupRequired,
      },
      { status: setupRequired ? 503 : 500 },
    );
  }
}

async function promoteEmailContacts(
  rows: ReturnType<typeof normalizeRow>[],
  batchLabel: string,
) {
  const contacts: LeadInsertRecord[] = rows.map((row) => {
    const name = splitName(row.contact_name);
    return {
      email: String(row.business_email),
      first_name: name.first || null,
      last_name: name.last || null,
      company: row.company_name || null,
      validation_status: "valid" as const,
      status: "pending",
      batch_label: batchLabel,
    };
  });
  return { inserted: await insertLeadsSkippingDuplicates(contacts) };
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

export async function PATCH(request: NextRequest) {
  try {
    const input = (await request.json()) as {
      id?: string;
      find_email_status?: string;
      business_email?: string;
      email_status?: string;
      validation_status?: "valid" | "invalid" | "disposable" | "unvalidated";
    };
    if (!input.id) {
      return NextResponse.json({ error: "Imported lead ID is required." }, { status: 400 });
    }
    const email = clean(input.business_email, 320).toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "The email address is invalid." }, { status: 400 });
    }
    await supabaseRequest(
      `imported_prospects?id=eq.${encodeURIComponent(input.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          find_email_status: clean(input.find_email_status, 40) || "review",
          business_email: email || null,
          email_status: clean(input.email_status, 80) || "Missing",
          updated_at: new Date().toISOString(),
        }),
        prefer: "return=minimal",
      },
    );
    if (email && input.validation_status) {
      await supabaseRequest(`leads?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ validation_status: input.validation_status }),
        prefer: "return=minimal",
      });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update the imported lead.",
      },
      { status: 500 },
    );
  }
}

function normalizeRow(row: ImportRow, sourceRow: number) {
  const website = normalizeWebsite(row.company_website || "");
  const email = clean(row.business_email, 320).toLowerCase();
  const validEmail = EMAIL_PATTERN.test(email) ? email : null;
  const spreadsheetVerified =
    Boolean(validEmail) &&
    isThirdPartyEmailVerified(
      row.email_status,
      row.third_party_email_verified,
    );
  return {
    company_name: clean(row.company_name, 200),
    company_website: website,
    company_linkedin: normalizeOptionalUrl(row.company_linkedin),
    location: clean(row.location, 200) || null,
    industry_services: clean(row.industry_services, 500) || null,
    employee_size: clean(row.employee_size, 80) || null,
    contact_name: clean(row.contact_name, 200),
    job_title: clean(row.job_title, 200) || null,
    contact_linkedin: normalizeOptionalUrl(row.contact_linkedin),
    business_email: validEmail,
    email_status: clean(row.email_status, 80) || (email ? "Unvalidated" : "Missing"),
    third_party_email_verified:
      clean(row.third_party_email_verified, 120) || null,
    why_this_lead_fits: clean(row.why_this_lead_fits, 1500) || null,
    lead_tier: clean(row.lead_tier, 80) || null,
    outreach_status: clean(row.outreach_status, 80) || "Research",
    last_contacted: normalizeDate(row.last_contacted),
    next_step: clean(row.next_step, 1000) || null,
    next_step_date: normalizeDate(row.next_step_date),
    notes: clean(row.notes, 3000) || null,
    assigned_to: clean(row.assigned_to, 160) || null,
    source_row: Number(row.source_row || sourceRow),
    find_email_status: spreadsheetVerified ? "approved" : "needs_find_email",
  };
}

function normalizeWebsite(value: string) {
  const raw = clean(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeOptionalUrl(value?: string | null) {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeDate(value?: string | null) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

type ImportInput = {
  source_file?: string;
  batch_label?: string;
  rows?: ImportRow[];
};

type ImportRow = {
  company_name?: string;
  company_website?: string;
  company_linkedin?: string;
  location?: string;
  industry_services?: string;
  employee_size?: string;
  contact_name?: string;
  job_title?: string;
  contact_linkedin?: string;
  business_email?: string;
  email_status?: string;
  why_this_lead_fits?: string;
  lead_tier?: string;
  outreach_status?: string;
  last_contacted?: string;
  next_step?: string;
  next_step_date?: string;
  notes?: string;
  assigned_to?: string;
  source_row?: number;
  third_party_email_verified?: string;
};

type ImportedProspect = ImportRow & {
  id: string;
  created_at: string;
  updated_at: string;
  find_email_status: string;
};

function stripImportOnlyFields(row: ReturnType<typeof normalizeRow>) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "third_party_email_verified"),
  );
}
