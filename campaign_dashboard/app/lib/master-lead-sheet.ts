export const MASTER_LEAD_SHEET_ID =
  "1HQ86nBqbuxPTuLQj33zPRTQvmcUo0HopoVnjV8d1aio";
export const MASTER_LEAD_SHEET_TAB = "Leads";
export const MASTER_LEAD_SHEET_NAME = "Master Leads - Combined";

export type MasterLeadSheetRow = {
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
  third_party_email_verified?: string;
  why_this_lead_fits?: string;
  lead_tier?: string;
  outreach_status?: string;
  last_contacted?: string;
  next_step?: string;
  next_step_date?: string;
  notes?: string;
  assigned_to?: string;
  source_row?: number;
};

export function masterLeadSheetCsvUrl() {
  const query = new URLSearchParams({
    tqx: "out:csv",
    sheet: MASTER_LEAD_SHEET_TAB,
  });
  return `https://docs.google.com/spreadsheets/d/${MASTER_LEAD_SHEET_ID}/gviz/tq?${query}`;
}

export function parseMasterLeadSheetCsv(value: string): MasterLeadSheetRow[] {
  const grid = parseCsv(value).filter((row) =>
    row.some((cell) => cell.trim()),
  );
  if (!grid.length) throw new Error("The master Google Sheet is empty.");

  const headers = grid[0].map(normalizeHeader);
  for (const required of [
    "company name",
    "contact name",
    "business email",
    "email verification",
    "third party email verified",
  ]) {
    if (!headers.includes(required)) {
      throw new Error(
        `The master Google Sheet is missing the required \"${required}\" column.`,
      );
    }
  }

  const get = (row: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? String(row[index] || "").trim() : "";
  };

  return grid
    .slice(1)
    .map((row, index) => ({
      company_name: get(row, ["company name"]),
      company_website: get(row, ["company website"]),
      company_linkedin: get(row, ["company linkedin"]),
      location: [get(row, ["location"]), get(row, ["state"])]
        .filter(Boolean)
        .join(", "),
      industry_services: get(row, ["industry services"]),
      employee_size: get(row, ["employee size"]),
      contact_name: get(row, ["contact name"]),
      job_title: get(row, ["job title"]),
      contact_linkedin: get(row, ["contact linkedin"]),
      business_email: get(row, ["business email"]),
      email_status: get(row, ["email verification"]),
      third_party_email_verified: get(row, [
        "third party email verified",
      ]),
      why_this_lead_fits: get(row, ["why this lead fits"]),
      lead_tier: get(row, ["lead score tier"]),
      outreach_status: get(row, ["outreach status"]),
      last_contacted: get(row, ["last contacted"]),
      next_step: get(row, ["next step"]),
      next_step_date: get(row, ["next step date"]),
      notes: get(row, ["reply lead notes"]),
      assigned_to: get(row, ["assigned to"]),
      source_row: index + 2,
    }))
    .filter((row) =>
      Boolean(row.company_name || row.contact_name || row.business_email),
    );
}

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
