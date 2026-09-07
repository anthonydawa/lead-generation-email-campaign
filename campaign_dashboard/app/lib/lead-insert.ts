import "server-only";
import { supabaseRequest } from "./supabase-admin";

export type LeadInsertRecord = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  validation_status: string;
  status: "pending";
  batch_label: string | null;
};

export async function insertLeadsSkippingDuplicates(
  records: LeadInsertRecord[],
): Promise<LeadInsertRecord[]> {
  const seen = new Set<string>();
  const uniqueRecords = records.filter((record) => {
    const email = record.email.trim().toLowerCase();
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  const existingEmails = await findExistingEmails(
    uniqueRecords.map((record) => record.email),
  );
  return insertWithConflictFallback(
    uniqueRecords.filter(
      (record) => !existingEmails.has(record.email.trim().toLowerCase()),
    ),
  );
}

async function findExistingEmails(emails: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < emails.length; index += 200) {
    chunks.push(emails.slice(index, index + 200));
  }
  const matches = await Promise.all(
    chunks.map((chunk) =>
      supabaseRequest<Array<{ email: string }>>(
        `leads?select=email&email=in.(${chunk
          .map((email) => encodeURIComponent(email.trim().toLowerCase()))
          .join(",")})&limit=${chunk.length}`,
      ),
    ),
  );
  return new Set(
    matches.flat().map((lead) => lead.email.trim().toLowerCase()),
  );
}

async function insertWithConflictFallback(
  records: LeadInsertRecord[],
): Promise<LeadInsertRecord[]> {
  if (!records.length) return [];
  try {
    return await supabaseRequest<LeadInsertRecord[]>("leads", {
      method: "POST",
      body: JSON.stringify(records),
      prefer: "return=representation",
    });
  } catch (error) {
    if (!isDuplicateEmailError(error)) throw error;
    if (records.length === 1) return [];
    const midpoint = Math.ceil(records.length / 2);
    const [first, second] = await Promise.all([
      insertWithConflictFallback(records.slice(0, midpoint)),
      insertWithConflictFallback(records.slice(midpoint)),
    ]);
    return [...first, ...second];
  }
}

function isDuplicateEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("leads_email_lower_unique") ||
    (message.includes("23505") && message.includes("lower(email)"))
  );
}
