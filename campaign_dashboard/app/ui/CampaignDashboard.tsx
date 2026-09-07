"use client";

import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ensureDefaultEmailFooter,
  personalizeEmailHtml,
  stripManagedEmailFooter,
} from "../lib/email-content";

type Tab = "overview" | "finder" | "library" | "stats" | "campaigns";
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
  created_at: string;
};
type Log = {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: string;
  step_number: number;
  sent_at: string;
};
type Assignment = {
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
type MessageTemplate = {
  id: string;
  name: string;
  subject_template: string;
  body_template: string;
  followups: Array<{ delay_days: number; body_template: string }>;
  created_at: string;
  updated_at: string;
};
type WorkerReport = {
  id: string;
  campaign_id: string;
  worker_kind: "gmail" | "lark_smtp";
  worker_status: string;
  sender_email: string | null;
  report_date: string;
  sent_today: number;
  bounced_today: number;
  replied_today: number;
  errors_today: number;
  deliveries_total: number;
  recipients_total: number;
  pending_total: number;
  scheduled_total: number;
  completed_total: number;
  replied_total: number;
  bounced_total: number;
  skipped_total: number;
  unsubscribed_total: number;
  uncertain_total: number;
  last_error: string | null;
  last_seen_at: string;
  updated_at: string;
};
type DashboardData = {
  leads: Lead[];
  campaigns: Campaign[];
  logs: Log[];
  assignments: Assignment[];
  steps: CampaignStep[];
  templates: MessageTemplate[];
  workerReports: WorkerReport[];
};
type Prospect = {
  id?: string;
  source_member_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  headline: string;
  job_title: string;
  company: string;
  industry: string;
  location: string;
  profile_url: string;
  source: "linkedin";
  saved_at?: string;
};
type SearchUsage = {
  used: number;
  limit: number;
  resets_at: string;
};
type WebLead = {
  id: string;
  company_name: string;
  website: string;
  source_url: string;
  description: string;
  location: string;
  emails: string[];
  phones: string[];
  linkedin_url: string;
  status: string;
  status_code: number;
  secure: boolean;
  response_ms: number;
};
type ProviderStatus = {
  name: string;
  status: "used" | "exhausted" | "error";
  used: number;
  limit: number;
  error: string | null;
};
type CompanyResearch = {
  id: string;
  company_name: string;
  website: string;
  summary: string;
  description: string;
  industry: string;
  services: string[];
  target_customers: string[];
  locations: string[];
  people: Array<{ name: string; role: string; source_url: string }>;
  emails: string[];
  phones: string[];
  linkedin_url: string;
  outreach_angle: string;
  qualification_score: number;
  qualification_reason: string;
  pages: Array<{ type: string; title: string; url: string }>;
  ai_provider: string;
  ai_model: string;
  ai_providers: ProviderStatus[];
  researched_at: string;
};
type ContactCandidate = {
  id?: string;
  email: string;
  origin: string;
  status: string;
  confidence: number;
  provider: string;
  reason: string;
  mx_found: boolean;
  catch_all: boolean;
  disposable: boolean;
  role_address: boolean;
  campaign_eligible: boolean;
  evidence_urls: string[];
  verification_details: unknown;
};
type SavedContactCandidate = ContactCandidate & {
  id: string;
  website: string;
  company_name: string;
  person_name: string;
  role: string | null;
  person_source_url: string;
  created_at: string;
  updated_at: string;
};
type ContactLookup = {
  person: string;
  role: string;
  company_name: string;
  website: string;
  person_source_url: string;
  domain: string;
  mx: { found: boolean; records: string[] };
  candidates: ContactCandidate[];
  providers: ProviderStatus[];
  verifier_setup_required: boolean;
  source_discovery?: {
    confirmed_on_company_site: boolean;
    inspected_pages: string[];
    company_email_examples: string[];
  };
  optimization?: {
    finder_skipped_reason: "published_email" | "company_pattern" | null;
    mx_cache_hit: boolean;
    verification_cache_hits: number;
    company_pattern: string | null;
    company_pattern_confidence: number;
    candidates_tested: number;
  };
};
type ImportedProspect = {
  id: string;
  company_name: string;
  company_website: string;
  company_linkedin: string | null;
  location: string | null;
  industry_services: string | null;
  employee_size: string | null;
  contact_name: string;
  job_title: string | null;
  contact_linkedin: string | null;
  business_email: string | null;
  email_status: string;
  why_this_lead_fits: string | null;
  lead_tier: string | null;
  outreach_status: string;
  last_contacted: string | null;
  next_step: string | null;
  next_step_date: string | null;
  notes: string | null;
  assigned_to: string | null;
  source_file: string;
  batch_label: string | null;
  source_row: number | null;
  find_email_status: string;
  created_at: string;
  updated_at: string;
};
type ImportPreviewRow = Omit<
  ImportedProspect,
  | "id"
  | "source_file"
  | "batch_label"
  | "find_email_status"
  | "created_at"
  | "updated_at"
> & {
  selected: boolean;
};
const initialData: DashboardData = {
  leads: [],
  campaigns: [],
  logs: [],
  assignments: [],
  steps: [],
  templates: [],
  workerReports: [],
};

export function CampaignDashboard() {
  const [tab, setTab] = useState<Tab>("finder");
  const [data, setData] = useState(initialData);
  const [savedProspects, setSavedProspects] = useState<Prospect[]>([]);
  const [importedProspects, setImportedProspects] = useState<ImportedProspect[]>([]);
  const [contactCandidates, setContactCandidates] = useState<
    SavedContactCandidate[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [subject, setSubject] = useState("A quick idea for {{company}}");
  const [body, setBody] = useState(
    "<p>Hi {{first_name}},</p><p>I wanted to share a quick idea that may help {{company}}.</p><p>Would you be open to a short conversation?</p>",
  );
  const [initialSendAt, setInitialSendAt] = useState(defaultLocalSendTime);
  const [followups, setFollowups] = useState([
    {
      delay_days: 3,
      body_template:
        "<p>Hi {{first_name}},</p><p>Just following up on my note below. Would a quick conversation be useful?</p>",
    },
  ]);
  const [leadDraft, setLeadDraft] = useState("");
  const [leadBatchLabel, setLeadBatchLabel] = useState("");
  const [saving, setSaving] = useState(false);
  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [
        dashboardResponse,
        prospectsResponse,
        importedResponse,
        candidatesResponse,
      ] =
        await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/prospects", { cache: "no-store" }),
        fetch("/api/lead-import", { cache: "no-store" }),
        fetch("/api/contact-candidates", { cache: "no-store" }),
      ]);
      const dashboard = await dashboardResponse.json();
      const prospects = await prospectsResponse.json();
      const imported = await importedResponse.json();
      const candidates = await candidatesResponse.json();
      if (!dashboardResponse.ok)
        throw new Error(dashboard.error ?? "Unable to load workspace");
      setData(dashboard);
      setSavedProspects(prospects.prospects ?? []);
      setImportedProspects(imported.prospects ?? []);
      setContactCandidates(candidates.candidates ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load workspace",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial workspace synchronization; later refreshes are user initiated.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const metrics = useMemo(() => {
    const sent = data.logs.filter((log) => log.status === "sent").length;
    const replied = data.leads.filter((lead) => lead.status === "replied").length;
    return {
      prospects: savedProspects.length,
      emailReady: data.leads.filter(
        (lead) => lead.validation_status === "valid",
      ).length,
      sent,
      replyRate: sent ? Math.round((replied / sent) * 100) : 0,
    };
  }, [data, savedProspects]);

  const eligibleLeads = data.leads.filter(
    (lead) => lead.validation_status === "valid" && lead.status === "pending",
  );

  const existingLabels = Array.from(
    new Set(
      [
        ...data.leads.map((lead) => lead.batch_label),
        ...importedProspects.map(
          (prospect) => prospect.batch_label || prospect.source_file,
        ),
      ].filter((label): label is string => Boolean(label?.trim())),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const selectedTemplate = data.templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const sentLeadIdsForTemplate = selectedTemplate
    ? Array.from(
        new Set(
          data.logs
            .filter((log) => {
              if (log.status !== "sent") return false;
              const campaign = data.campaigns.find(
                (item) => item.id === log.campaign_id,
              );
              return (
                campaign?.message_template_id === selectedTemplate.id ||
                (!campaign?.message_template_id &&
                  campaign?.subject_template === selectedTemplate.subject_template &&
                  campaign?.body_template === selectedTemplate.body_template)
              );
            })
            .map((log) => log.lead_id),
        ),
      )
    : [];

  function openComposer() {
    setSelectedLeadIds([]);
    setSelectedTemplateId("");
    setTemplateName("");
    setComposerOpen(true);
    setNotice("");
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          sender_email: senderEmail || undefined,
          message_template_id: selectedTemplateId,
          subject_template: subject,
          body_template: body,
          initial_send_at: new Date(initialSendAt).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          followups,
          lead_ids: selectedLeadIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Campaign creation failed");
      setComposerOpen(false);
      setTitle("");
      setSelectedTemplateId("");
      setInitialSendAt(defaultLocalSendTime());
      setNotice("Campaign staged and ready for the local sender.");
      setTab("campaigns");
      await loadData();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create",
      );
    } finally {
      setSaving(false);
    }
  }

  async function importLeads(event: FormEvent) {
    event.preventDefault();
    let leads: ReturnType<typeof parseLeads>;
    try {
      leads = parseLeads(leadDraft);
    } catch (parseError) {
      setError(
        parseError instanceof Error ? parseError.message : "Unable to read that CSV.",
      );
      return;
    }
    if (!leads.length) {
      setError("Paste at least one email address.");
      return;
    }
    if (!leadBatchLabel.trim()) {
      setError("Choose or enter a batch label for these contacts.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads, batch_label: leadBatchLabel.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Lead import failed");
      setLeadDraft("");
      setNotice(
        `${payload.inserted} email-ready lead${payload.inserted === 1 ? "" : "s"} imported.`,
      );
      await loadData();
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "Unable to import",
      );
    } finally {
      setSaving(false);
    }
  }

  function loadCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setLeadBatchLabel(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const contents = String(reader.result ?? "");
      try {
        const contacts = parseLeads(contents);
        setLeadDraft(contents);
        setNotice(
          `${contacts.length} contact${contacts.length === 1 ? "" : "s"} loaded from ${file.name}. Review the batch label, then click Import contacts.`,
        );
      } catch (parseError) {
        setLeadDraft("");
        setError(
          parseError instanceof Error
            ? parseError.message
            : "Unable to read that CSV.",
        );
      }
    };
    reader.onerror = () => setError(`Unable to read ${file.name}.`);
    reader.readAsText(file);
    event.target.value = "";
  }

  async function saveTemplate() {
    setTemplateSaving(true);
    setError("");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          subject_template: subject,
          body_template: body,
          followups,
        }),
      });
      const template = (await response.json()) as MessageTemplate & {
        error?: string;
      };
      if (!response.ok) throw new Error(template.error || "Unable to save template.");
      setData((current) => ({
        ...current,
        templates: [template, ...current.templates],
      }));
      setSelectedTemplateId(template.id);
      setNotice(`Template “${template.name}” saved.`);
      return template;
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save template.",
      );
      return null;
    } finally {
      setTemplateSaving(false);
    }
  }

  const titles: Record<Tab, [string, string]> = {
    overview: ["Workspace pulse", "Good morning, Anthony."],
    finder: ["Lead intelligence", "Find the right people."],
    library: ["Saved audiences", "Your lead library."],
    stats: ["Campaign intelligence", "Outreach performance."],
    campaigns: ["Email outreach", "Campaigns."],
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span>Relay</span>
        </div>
        <nav aria-label="Primary navigation">
          <NavButton
            label="Overview"
            icon="⌂"
            active={tab === "overview"}
            onClick={() => setTab("overview")}
          />
          <p className="nav-label">Prospecting</p>
          <NavButton
            label="Find leads"
            icon="⌕"
            active={tab === "finder"}
            onClick={() => setTab("finder")}
          />
          <NavButton
            label="Saved leads"
            icon="♡"
            count={
              savedProspects.length +
              contactCandidates.length +
              importedProspects.length
            }
            active={tab === "library"}
            onClick={() => setTab("library")}
          />
          <p className="nav-label">Outreach</p>
          <NavButton
            label="Campaign stats"
            icon="◫"
            active={tab === "stats"}
            onClick={() => setTab("stats")}
          />
          <NavButton
            label="Email campaigns"
            icon="↗"
            count={data.campaigns.length}
            active={tab === "campaigns"}
            onClick={() => setTab("campaigns")}
          />
        </nav>
        <div className="compliance-card">
          <div className="worker-status">
            <span className="status-light" />
            API guardrails active
          </div>
          <p>Approved endpoints only. Daily usage and source records are tracked.</p>
        </div>
        <div className="account-chip">
          <span className="avatar">AD</span>
          <div>
            <strong>Anthony Dawa</strong>
            <span>Workspace owner</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{titles[tab][0]}</span>
            <h1>{titles[tab][1]}</h1>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-state">Syncing your workspace…</div>
        ) : tab === "finder" ? (
          <WebLeadFinder
            setNotice={setNotice}
            setError={setError}
            onContactApproved={loadData}
          />
        ) : tab === "library" ? (
          <LeadLibrary
            prospects={savedProspects}
            importedProspects={importedProspects}
            contactCandidates={contactCandidates}
            leads={data.leads}
            draft={leadDraft}
            setDraft={setLeadDraft}
            batchLabel={leadBatchLabel}
            setBatchLabel={setLeadBatchLabel}
            existingLabels={existingLabels}
            onImport={importLeads}
            onFile={loadCsv}
            saving={saving}
            onDelete={(id) =>
              setSavedProspects((current) =>
                current.filter((prospect) => prospect.id !== id),
              )
            }
            setError={setError}
            setNotice={setNotice}
            onImported={loadData}
          />
        ) : tab === "stats" ? (
          <CampaignStats data={data} />
        ) : tab === "campaigns" ? (
          <Campaigns
            data={data}
            onCreate={openComposer}
            onUpdated={loadData}
            setError={setError}
            setNotice={setNotice}
          />
        ) : (
          <Overview
            data={data}
            metrics={metrics}
            onNavigate={setTab}
            onCreate={openComposer}
          />
        )}
      </section>

      {composerOpen && (
        <CampaignComposer
          templates={data.templates}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          templateName={templateName}
          setTemplateName={setTemplateName}
          templateSaving={templateSaving}
          onSaveTemplate={saveTemplate}
          eligibleLeads={eligibleLeads}
          sentLeadIds={sentLeadIdsForTemplate}
          existingLabels={existingLabels}
          selectedLeadIds={selectedLeadIds}
          setSelectedLeadIds={setSelectedLeadIds}
          title={title}
          setTitle={setTitle}
          senderEmail={senderEmail}
          setSenderEmail={setSenderEmail}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          initialSendAt={initialSendAt}
          setInitialSendAt={setInitialSendAt}
          followups={followups}
          setFollowups={setFollowups}
          saving={saving}
          onSubmit={createCampaign}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </main>
  );
}

function NavButton({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      {label}
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  );
}

function WebLeadFinder({
  setNotice,
  setError,
  onContactApproved,
}: {
  setNotice: (value: string) => void;
  setError: (value: string) => void;
  onContactApproved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("United States");
  const [limit, setLimit] = useState(10);
  const [results, setResults] = useState<WebLead[]>([]);
  const [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [searched, setSearched] = useState(false);
  const [researchingWebsite, setResearchingWebsite] = useState("");
  const [researchErrors, setResearchErrors] = useState<Record<string, string>>({});
  const [research, setResearch] = useState<CompanyResearch | null>(null);
  const [savingResearch, setSavingResearch] = useState(false);
  const [findingPerson, setFindingPerson] = useState("");
  const [contactLookup, setContactLookup] = useState<ContactLookup | null>(null);
  const [savingCandidate, setSavingCandidate] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearched(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({
        query,
        location,
        limit: String(limit),
      });
      const response = await fetch(`/api/web-leads?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Web discovery failed");
      setResults(payload.results ?? []);
      setProvider(payload.provider ?? "web");
      setProviders(payload.providers ?? []);
      setNotice(
        `${payload.results?.length ?? 0} websites checked for “${query}”.`,
      );
    } catch (searchError) {
      setResults([]);
      setProviders([]);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Unable to search the web.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function saveQuery() {
    setSavingSearch(true);
    setError("");
    try {
      const response = await fetch("/api/web-leads/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, provider, results }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to save this search");
      setNotice(
        `Search saved with ${payload.saved} company record${payload.saved === 1 ? "" : "s"}.`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save search",
      );
    } finally {
      setSavingSearch(false);
    }
  }

  async function researchCompany(lead: WebLead) {
    setResearchingWebsite(lead.website);
    setResearchErrors((current) => ({ ...current, [lead.website]: "" }));
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/company-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: lead.website,
          company_name: lead.company_name,
          query,
          location,
        }),
        signal: AbortSignal.timeout(55_000),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to research this company");
      setResearch(payload.research);
      if (payload.ai_setup_required) {
        setNotice(
          "Public website facts were extracted. Add a supported AI key for summaries and qualification.",
        );
      }
    } catch (researchError) {
      const message =
        researchError instanceof Error &&
        ["AbortError", "TimeoutError"].includes(researchError.name)
          ? "Research took too long on this website. Please try again; Relay will use a smaller source set on the next run."
          : researchError instanceof Error
            ? researchError.message
            : "Unable to research this company";
      setResearchErrors((current) => ({
        ...current,
        [lead.website]: message,
      }));
      setError(message);
    } finally {
      setResearchingWebsite("");
    }
  }

  async function saveResearch() {
    if (!research) return;
    setSavingResearch(true);
    setError("");
    try {
      const response = await fetch("/api/company-research/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(research),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to save company research");
      setNotice(`${research.company_name} research was saved to Supabase.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save company research",
      );
    } finally {
      setSavingResearch(false);
    }
  }

  async function findContact(person: {
    name: string;
    role: string;
    source_url: string;
  }) {
    if (!research) return;
    setFindingPerson(person.name);
    setContactLookup(null);
    setError("");
    try {
      const response = await fetch("/api/contact-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_name: person.name,
          role: person.role,
          person_source_url: person.source_url,
          company_name: research.company_name,
          website: research.website,
          public_emails: research.emails,
          evidence_urls: research.pages.map((page) => page.url),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to find this contact");
      setContactLookup(payload);
      if (payload.verifier_setup_required) {
        setNotice(
          "Email candidates were generated locally. Add a free verifier key before approving one for campaigns.",
        );
      }
    } catch (contactError) {
      setError(
        contactError instanceof Error
          ? contactError.message
          : "Unable to find this contact",
      );
    } finally {
      setFindingPerson("");
    }
  }

  async function persistCandidate(
    candidate: ContactCandidate,
    action: "save" | "approve",
  ) {
    if (!contactLookup) return;
    setSavingCandidate(`${action}:${candidate.email}`);
    setError("");
    try {
      const response = await fetch("/api/contact-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...candidate,
          website: contactLookup.website,
          company_name: contactLookup.company_name,
          person_name: contactLookup.person,
          role: contactLookup.role,
          person_source_url: contactLookup.person_source_url,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to save this contact");
      setNotice(
        action === "approve"
          ? `${contactLookup.person} was added as a validated campaign contact.`
          : `${candidate.email} was saved to Saved leads → Email verification queue.`,
      );
      setContactLookup((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.map((item) =>
                item.email === candidate.email
                  ? { ...item, id: payload.candidate_id }
                  : item,
              ),
            }
          : current,
      );
      await onContactApproved();
    } catch (candidateError) {
      setError(
        candidateError instanceof Error
          ? candidateError.message
          : "Unable to save this contact",
      );
    } finally {
      setSavingCandidate("");
    }
  }

  const liveCount = results.filter((lead) => lead.status === "live").length;
  const emailCount = results.reduce(
    (total, lead) => total + lead.emails.length,
    0,
  );

  return (
    <div className="web-finder">
      <section className="web-search-panel">
        <div className="web-search-copy">
          <span className="eyebrow">Live web discovery</span>
          <h2>Describe the companies you want to find.</h2>
          <p>
            Relay searches the open web, identifies likely company websites,
            checks whether they respond, and extracts public business contact
            details from permitted pages. Search sources are used one at a time
            to conserve free API credits.
          </p>
        </div>
        <form onSubmit={search}>
          <label className="web-query">
            <span>What are you looking for?</span>
            <div>
              <span className="search-glyph">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. digital marketing agencies"
                required
              />
            </div>
          </label>
          <div className="web-search-controls">
            <label>
              Location
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="United States"
              />
            </label>
            <label>
              Results
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="15">15</option>
              </select>
            </label>
            <button className="primary-button" disabled={searching}>
              {searching ? "Finding and checking…" : "Find companies"}
            </button>
          </div>
        </form>
      </section>

      {(searched || results.length > 0) && (
        <>
          {providers.length > 0 && (
            <div className="provider-strip">
              <span>Sources</span>
              {providers.map((item) => (
                <div
                  className={`provider-chip ${item.status}`}
                  key={item.name}
                  title={item.error || `${item.used} of ${item.limit} locally tracked`}
                >
                  <i />
                  <strong>{providerLabel(item.name)}</strong>
                  <small>
                    {item.status === "used"
                      ? `${item.used}/${item.limit}`
                      : item.status}
                  </small>
                </div>
              ))}
            </div>
          )}
          <div className="web-results-toolbar">
            <div>
              <strong>{results.length} companies</strong>
              <span>{liveCount} live websites</span>
              <span>{emailCount} public emails found</span>
            </div>
            <button
              className="secondary-button"
              disabled={!results.length || savingSearch}
              onClick={saveQuery}
            >
              {savingSearch ? "Saving…" : "Save query & results"}
            </button>
          </div>
        </>
      )}

      <section className="web-results" aria-live="polite">
        {results.map((lead) => (
          <article className="web-lead-card" key={lead.id}>
            <div className="website-status">
              <span className={lead.status === "live" ? "live" : "offline"} />
              {lead.status === "live" ? "Website live" : lead.status.replaceAll("_", " ")}
            </div>
            <div className="web-lead-heading">
              <div>
                <h2>{lead.company_name}</h2>
                <a href={lead.website} target="_blank" rel="noreferrer">
                  {lead.website.replace(/^https?:\/\//, "")} ↗
                </a>
              </div>
              <span className={lead.secure ? "secure-chip" : "warning-chip"}>
                {lead.secure ? "HTTPS" : "HTTP"}
              </span>
            </div>
            <p>{lead.description || "No site description was available."}</p>
            <div className="contact-findings">
              <div>
                <span>Public emails</span>
                {lead.emails.length ? (
                  lead.emails.map((email) => (
                    <a key={email} href={`mailto:${email}`}>
                      {email}
                    </a>
                  ))
                ) : (
                  <small>None published on checked pages</small>
                )}
              </div>
              <div>
                <span>Public phones</span>
                {lead.phones.length ? (
                  lead.phones.map((phone) => <strong key={phone}>{phone}</strong>)
                ) : (
                  <small>None found</small>
                )}
              </div>
            </div>
            {researchErrors[lead.website] && (
              <div className="research-card-error" role="alert">
                {researchErrors[lead.website]}
              </div>
            )}
            <footer>
              <span>Checked in {lead.response_ms} ms</span>
              <button
                className="research-button"
                disabled={
                  lead.status !== "live" || Boolean(researchingWebsite)
                }
                onClick={() => researchCompany(lead)}
              >
                {researchingWebsite === lead.website
                  ? "Researching..."
                  : "Research company"}
              </button>
              {lead.linkedin_url && (
                <a href={lead.linkedin_url} target="_blank" rel="noreferrer">
                  Company profile ↗
                </a>
              )}
              <a href={lead.source_url} target="_blank" rel="noreferrer">
                Search source ↗
              </a>
            </footer>
          </article>
        ))}
        {searched && !searching && !results.length && (
          <div className="panel empty-table">
            No company websites were returned. Try a broader niche or location.
          </div>
        )}
      </section>

      {research && (
        <div
          className="research-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setResearch(null);
          }}
        >
          <section
            className="research-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="research-title"
          >
            <header>
              <div>
                <span className="eyebrow">Controlled company research</span>
                <h2 id="research-title">{research.company_name}</h2>
                <a href={research.website} target="_blank" rel="noreferrer">
                  {research.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
              <button
                className="research-close"
                aria-label="Close company research"
                onClick={() => setResearch(null)}
              >
                x
              </button>
            </header>

            <div className="research-score">
              <strong>{Math.round(research.qualification_score)}</strong>
              <div>
                <span>Qualification score</span>
                <p>{research.qualification_reason}</p>
              </div>
            </div>

            <div className="research-section">
              <span>Company summary</span>
              <p>{research.summary || research.description}</p>
              {research.industry && <strong>{research.industry}</strong>}
            </div>

            <div className="research-grid">
              <ResearchList title="Services" items={research.services} />
              <ResearchList
                title="Target customers"
                items={research.target_customers}
              />
              <ResearchList title="Locations" items={research.locations} />
              <ResearchList title="Public emails" items={research.emails} />
            </div>

            <div className="research-section">
              <span>Public decision-makers</span>
              {research.people.length ? (
                <div className="research-people">
                  {research.people.map((person) => (
                    <div key={`${person.name}-${person.role}`}>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.role || "Role not stated"}</small>
                      </span>
                      <a
                        href={person.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source
                      </a>
                      <button
                        disabled={findingPerson === person.name}
                        onClick={() => findContact(person)}
                      >
                        {findingPerson === person.name
                          ? "Finding..."
                          : "Find email"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No named decision-makers were confirmed on the checked pages.</p>
              )}
            </div>

            {contactLookup && (
              <section className="contact-lookup">
                <header>
                  <div>
                    <span className="eyebrow">Email candidate review</span>
                    <h3>{contactLookup.person}</h3>
                    <small>
                      {contactLookup.domain} /{" "}
                      {contactLookup.mx.found ? "mail server found" : "no mail server"}
                    </small>
                  </div>
                  <button
                    aria-label="Close email candidate review"
                    onClick={() => setContactLookup(null)}
                  >
                    x
                  </button>
                </header>

                {contactLookup.optimization && (
                  <p className="source-discovery-note">
                    {contactLookup.optimization.finder_skipped_reason ===
                    "published_email"
                      ? "Exact public email found, so no finder credit was used."
                      : contactLookup.optimization.finder_skipped_reason ===
                          "company_pattern"
                        ? "A saved company email pattern was reused before spending a finder credit."
                        : "Finder providers were used only after free public and pattern checks."}{" "}
                    {contactLookup.optimization.verification_cache_hits > 0 &&
                      `${contactLookup.optimization.verification_cache_hits} recent verification result reused. `}
                    {contactLookup.optimization.mx_cache_hit &&
                      "The saved mail-server check was reused."}
                  </p>
                )}

                {contactLookup.providers.length > 0 && (
                  <div className="provider-strip">
                    <span>Find and verify</span>
                    {contactLookup.providers.map((item) => (
                      <div
                        className={`provider-chip ${item.status}`}
                        key={item.name}
                        title={
                          item.error ||
                          `${item.used} of ${item.limit} locally tracked`
                        }
                      >
                        <i />
                        <strong>{providerLabel(item.name)}</strong>
                        <small>
                          {item.status === "used"
                            ? `${item.used}/${item.limit}`
                            : item.status}
                        </small>
                      </div>
                    ))}
                  </div>
                )}

                <div className="candidate-list">
                  {contactLookup.candidates.map((candidate) => (
                    <article
                      className={
                        candidate.campaign_eligible
                          ? "candidate-card eligible"
                          : "candidate-card"
                      }
                      key={candidate.email}
                    >
                      <div className="candidate-heading">
                        <div>
                          <strong>{candidate.email}</strong>
                          <small>
                            {candidate.origin} / {candidate.status} /{" "}
                            {providerLabel(candidate.provider)}
                          </small>
                        </div>
                        <span>{candidate.confidence}%</span>
                      </div>
                      <p>{candidate.reason}</p>
                      <div className="candidate-flags">
                        <span>{candidate.mx_found ? "MX found" : "No MX"}</span>
                        {candidate.catch_all && <span>Catch-all</span>}
                        {candidate.disposable && <span>Disposable</span>}
                        {candidate.role_address && <span>Role address</span>}
                        {candidate.campaign_eligible && (
                          <strong>Campaign eligible</strong>
                        )}
                      </div>
                      <footer>
                        <button
                          className="secondary-button"
                          disabled={
                            Boolean(candidate.id) ||
                            savingCandidate === `save:${candidate.email}`
                          }
                          onClick={() => persistCandidate(candidate, "save")}
                        >
                          {candidate.id
                            ? "Saved"
                            : savingCandidate === `save:${candidate.email}`
                              ? "Saving..."
                              : "Save candidate"}
                        </button>
                        <button
                          className="primary-button"
                          disabled={
                            !candidate.campaign_eligible ||
                            savingCandidate === `approve:${candidate.email}`
                          }
                          onClick={() => persistCandidate(candidate, "approve")}
                        >
                          {savingCandidate === `approve:${candidate.email}`
                            ? "Adding..."
                            : "Approve & add contact"}
                        </button>
                      </footer>
                    </article>
                  ))}
                  {!contactLookup.candidates.length && (
                    <p className="candidate-empty">
                      No safe email candidates were produced for this person.
                    </p>
                  )}
                </div>
              </section>
            )}

            <div className="research-section outreach">
              <span>Suggested outreach angle</span>
              <p>
                {research.outreach_angle ||
                  "Add an AI provider to generate a source-grounded outreach angle."}
              </p>
            </div>

            {research.ai_providers.length > 0 && (
              <div className="provider-strip research-providers">
                <span>AI usage</span>
                {research.ai_providers.map((item) => (
                  <div
                    className={`provider-chip ${item.status}`}
                    key={item.name}
                    title={
                      item.error ||
                      `${item.used} of ${item.limit} locally tracked`
                    }
                  >
                    <i />
                    <strong>{providerLabel(item.name)}</strong>
                    <small className={item.error ? "provider-error" : ""}>
                      {item.error ||
                        (item.status === "used"
                          ? `${item.used}/${item.limit}`
                          : item.status)}
                    </small>
                  </div>
                ))}
              </div>
            )}

            <div className="research-sources">
              <span>{research.pages.length} public pages checked</span>
              {research.pages.map((page) => (
                <a href={page.url} target="_blank" rel="noreferrer" key={page.url}>
                  {page.type}
                </a>
              ))}
            </div>

            <footer>
              <small>
                Analyzed by {providerLabel(research.ai_provider)}
                {research.ai_model ? ` / ${research.ai_model}` : ""}
              </small>
              <button
                className="primary-button"
                disabled={savingResearch}
                onClick={saveResearch}
              >
                {savingResearch ? "Saving..." : "Save research"}
              </button>
            </footer>
          </section>
        </div>
      )}

      <aside className="terms-note">
        <strong>Public-web research only</strong>
        <p>
          Relay checks a small number of public pages, respects robots.txt,
          records the source URL, and never bypasses authentication or extracts
          private LinkedIn member data.
        </p>
      </aside>
    </div>
  );
}

function providerLabel(value: string) {
  const labels: Record<string, string> = {
    tavily: "Tavily",
    serper: "Serper",
    brave: "Brave",
    serpapi: "SerpApi",
    exa: "Exa",
    gemini: "Gemini",
    groq: "Groq",
    cohere: "Cohere",
    openrouter: "OpenRouter",
    cloudflare: "Cloudflare AI",
    hunter: "Hunter",
    zerobounce_finder: "ZeroBounce Finder",
    zerobounce: "ZeroBounce",
    mailboxlayer: "Mailboxlayer",
    verifalia: "Verifalia",
    bouncer: "Bouncer",
    local: "Local checks",
    "rules-only": "rules only",
  };
  return labels[value] || value;
}

function ResearchList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <span>{title}</span>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <small>None confirmed</small>
      )}
    </div>
  );
}

function LeadFinder({
  saved,
  onSaved,
  setNotice,
  setError,
}: {
  saved: Prospect[];
  onSaved: (prospect: Prospect) => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
}) {
  const [filters, setFilters] = useState({
    keywords: "",
    role: "",
    industry: "",
    location: "",
    company: "",
  });
  const [results, setResults] = useState<Prospect[]>([]);
  const [usage, setUsage] = useState<SearchUsage>({
    used: 0,
    limit: 100,
    resets_at: "",
  });
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState("");

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setSearching(true);
    setError("");
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value.trim()),
    );
    try {
      const response = await fetch(`/api/lead-search?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Search failed");
      setResults(payload.results ?? []);
      setUsage(payload.usage);
      setMode(payload.mode);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Unable to search",
      );
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    // Load the initial saved-prospect result set once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void search();
    // Initial result set only; later requests are initiated by the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProspect(prospect: Prospect) {
    setSavingId(prospect.source_member_id);
    setError("");
    try {
      const response = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save lead");
      onSaved(payload.prospect);
      setNotice(`${prospect.full_name} was saved to your lead library.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save lead",
      );
    } finally {
      setSavingId("");
    }
  }

  const usedPercentage = Math.min(
    100,
    Math.round((usage.used / Math.max(1, usage.limit)) * 100),
  );

  return (
    <div className="finder-layout">
      <section className="finder-hero">
        <form className="finder-form" onSubmit={search}>
          <div className="search-main">
            <span className="search-glyph">⌕</span>
            <input
              aria-label="Search keywords"
              placeholder="Search people, skills, or company"
              value={filters.keywords}
              onChange={(event) =>
                setFilters({ ...filters, keywords: event.target.value })
              }
            />
            <button className="primary-button" disabled={searching}>
              {searching ? "Searching…" : "Search leads"}
            </button>
          </div>
          <div className="filter-grid">
            <Filter
              label="Role"
              placeholder="e.g. VP Sales"
              value={filters.role}
              onChange={(role) => setFilters({ ...filters, role })}
            />
            <Filter
              label="Industry"
              placeholder="e.g. Software"
              value={filters.industry}
              onChange={(industry) => setFilters({ ...filters, industry })}
            />
            <Filter
              label="Location"
              placeholder="e.g. Singapore"
              value={filters.location}
              onChange={(location) => setFilters({ ...filters, location })}
            />
            <Filter
              label="Company"
              placeholder="e.g. Northstar"
              value={filters.company}
              onChange={(company) => setFilters({ ...filters, company })}
            />
          </div>
        </form>
        <div className="finder-meta">
          <div className="result-heading">
            <span className={mode === "live" ? "live-badge" : "demo-badge"}>
              {mode === "live" ? "Live approved API" : "Demo dataset"}
            </span>
            <strong>{results.length} people found</strong>
            <span>Sorted by relevance</span>
          </div>
          <div className="quota-meter" title="Configured daily API budget">
            <span>
              Daily API usage <strong>{usage.used} / {usage.limit}</strong>
            </span>
            <div><i style={{ width: `${usedPercentage}%` }} /></div>
            <small>Resets at 00:00 UTC</small>
          </div>
        </div>
      </section>

      <section className="results-list" aria-live="polite">
        {results.map((prospect) => {
          const isSaved = saved.some(
            (item) => item.source_member_id === prospect.source_member_id,
          );
          return (
            <article className="prospect-card" key={prospect.source_member_id}>
              <div className="prospect-avatar">
                {initials(prospect.full_name)}
              </div>
              <div className="prospect-main">
                <div className="prospect-title">
                  <div>
                    <h2>{prospect.full_name}</h2>
                    <p>{prospect.headline}</p>
                  </div>
                  <button
                    className={isSaved ? "saved-button" : "save-button"}
                    disabled={isSaved || savingId === prospect.source_member_id}
                    onClick={() => saveProspect(prospect)}
                  >
                    {isSaved
                      ? "✓ Saved"
                      : savingId === prospect.source_member_id
                        ? "Saving…"
                        : "＋ Save lead"}
                  </button>
                </div>
                <div className="prospect-facts">
                  <span>▣ {prospect.company}</span>
                  <span>⌖ {prospect.location}</span>
                  <span>◌ {prospect.industry}</span>
                </div>
                <div className="prospect-footer">
                  <span className="source-chip">in · LinkedIn source</span>
                  <span>No email stored</span>
                  {prospect.profile_url && (
                    <a
                      href={prospect.profile_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View permitted profile ↗
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
      <aside className="terms-note">
        <strong>Built for compliant prospecting</strong>
        <p>
          Relay uses only approved API responses, keeps LinkedIn-sourced records
          identifiable for deletion, and never invents or scrapes contact data.
          Email outreach starts only after a separate, validated address is
          added.
        </p>
      </aside>
    </div>
  );
}

function Filter({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ResearchLeadImporter({
  setError,
  setNotice,
  onImported,
  existingLabels = [],
}: {
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onImported: () => Promise<void>;
  existingLabels?: string[];
}) {
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [importing, setImporting] = useState(false);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseResearchSpreadsheet(String(reader.result || ""));
        if (!rows.length) {
          throw new Error(
            "No lead rows were found. Export the Lead Tracker tab as CSV or TSV.",
          );
        }
        setFileName(file.name);
        setBatchLabel(file.name);
        setPreview(rows);
        setNotice(
          `${rows.length} spreadsheet lead${rows.length === 1 ? "" : "s"} ready to review.`,
        );
      } catch (fileError) {
        setPreview([]);
        setFileName("");
        setError(
          fileError instanceof Error
            ? fileError.message
            : "Unable to read that spreadsheet export.",
        );
      }
    };
    reader.readAsText(file);
  }

  async function importSelected() {
    const selected = preview.filter((row) => row.selected);
    if (!selected.length) {
      setError("Select at least one spreadsheet lead.");
      return;
    }
    if (!batchLabel.trim()) {
      setError("Choose or enter a batch label for this import.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/lead-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_file: fileName,
          batch_label: batchLabel.trim(),
          rows: selected.map(({ selected: _selected, ...row }) => row),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to import spreadsheet leads.");
      setPreview([]);
      setFileName("");
      setNotice(
        `${payload.imported} lead${payload.imported === 1 ? "" : "s"} saved. ${payload.verified_contacts || 0} spreadsheet-verified contact${payload.verified_contacts === 1 ? "" : "s"} added to the campaign list; ${payload.queued_for_find_email || 0} sent to Find Email.`,
      );
      await onImported();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Unable to import spreadsheet leads.",
      );
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = preview.filter((row) => row.selected).length;
  return (
    <section className="panel research-import-panel">
      <div className="research-import-copy">
        <span className="eyebrow">Research spreadsheet</span>
        <h2>Upload your Lead Tracker</h2>
        <p>
          In Google Sheets, open the Lead Tracker tab and choose File → Download
          → Comma-separated values. Relay recognizes your existing column names,
          keeps leads without emails, and creates a find-email queue.
        </p>
        <div className="import-actions">
          <label className="file-button">
            Choose CSV or TSV
            <input
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={chooseFile}
            />
          </label>
          {preview.length > 0 && (
            <button
              className="primary-button"
              disabled={importing || !selectedCount}
              onClick={importSelected}
            >
              {importing
                ? "Saving…"
                : `Save ${selectedCount} lead${selectedCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
        {preview.length > 0 && (
          <label className="batch-label-field">
            Batch label
            <input
              list="research-lead-labels"
              value={batchLabel}
              onChange={(event) => setBatchLabel(event.target.value)}
              placeholder="Use the filename or choose an existing label"
            />
            <datalist id="research-lead-labels">
              {existingLabels.map((label) => (
                <option value={label} key={label} />
              ))}
            </datalist>
          </label>
        )}
      </div>
      <div className="import-preview">
        {preview.length ? (
          <>
            <div className="preview-heading">
              <span>
                <strong>{fileName}</strong>
                <small>{selectedCount} selected</small>
              </span>
              <button
                className="text-button"
                onClick={() =>
                  setPreview((rows) =>
                    rows.map((row) => ({ ...row, selected: true })),
                  )
                }
              >
                Select all
              </button>
            </div>
            <div className="preview-rows">
              {preview.slice(0, 12).map((row, index) => (
                <label
                  className={row.selected ? "preview-row selected" : "preview-row"}
                  key={`${row.company_website}-${row.contact_name}-${index}`}
                >
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={() =>
                      setPreview((rows) =>
                        rows.map((item, rowIndex) =>
                          rowIndex === index
                            ? { ...item, selected: !item.selected }
                            : item,
                        ),
                      )
                    }
                  />
                  <span>
                    <strong>{row.contact_name}</strong>
                    <small>{row.job_title || "Role not supplied"}</small>
                  </span>
                  <span>
                    <strong>{row.company_name}</strong>
                    <small>{row.business_email || "Email missing"}</small>
                  </span>
                </label>
              ))}
            </div>
            {preview.length > 12 && (
              <small className="preview-more">
                Plus {preview.length - 12} more rows in this import.
              </small>
            )}
          </>
        ) : (
          <div className="upload-empty">
            <strong>No file selected</strong>
            <span>Your spreadsheet stays unchanged; imported rows are copied to Supabase.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ImportedProspectQueue({
  prospects,
  setError,
  setNotice,
  onUpdated,
}: {
  prospects: ImportedProspect[];
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [findingId, setFindingId] = useState("");
  const [activeProspect, setActiveProspect] = useState<ImportedProspect | null>(
    null,
  );
  const [lookup, setLookup] = useState<ContactLookup | null>(null);
  const [savingCandidate, setSavingCandidate] = useState("");

  async function findEmail(prospect: ImportedProspect) {
    setFindingId(prospect.id);
    setActiveProspect(prospect);
    setLookup(null);
    setError("");
    try {
      const response = await fetch("/api/contact-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_name: prospect.contact_name,
          role: prospect.job_title,
          person_source_url:
            prospect.contact_linkedin || prospect.company_website,
          company_name: prospect.company_name,
          website: prospect.company_website,
          public_emails: prospect.business_email
            ? [prospect.business_email]
            : [],
          evidence_urls: [
            prospect.company_website,
            prospect.company_linkedin,
            prospect.contact_linkedin,
          ].filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to find this email.");
      setLookup(payload);
      await updateImportedProspect(prospect.id, {
        find_email_status: payload.candidates?.length
          ? "candidates_found"
          : "not_found",
      });
      if (payload.verifier_setup_required) {
        setNotice(
          "Candidates were generated from public evidence and company patterns. Add a free verifier key to approve one.",
        );
      }
    } catch (findError) {
      setError(
        findError instanceof Error
          ? findError.message
          : "Unable to find this email.",
      );
    } finally {
      setFindingId("");
    }
  }

  async function saveCandidate(
    candidate: ContactCandidate,
    action: "save" | "approve",
  ) {
    if (!lookup || !activeProspect) return;
    setSavingCandidate(`${action}:${candidate.email}`);
    setError("");
    try {
      const response = await fetch("/api/contact-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...candidate,
          website: lookup.website,
          company_name: lookup.company_name,
          person_name: lookup.person,
          role: lookup.role,
          person_source_url: lookup.person_source_url,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to save this email.");
      await updateImportedProspect(activeProspect.id, {
        find_email_status: action === "approve" ? "approved" : "candidate_saved",
        business_email: candidate.email,
        email_status:
          action === "approve" ? "Verified" : candidate.status || "Candidate",
      });
      setNotice(
        action === "approve"
          ? `${candidate.email} was verified and added as a campaign contact.`
          : `${candidate.email} was saved for review.`,
      );
      if (action === "approve") {
        setLookup(null);
        setActiveProspect(null);
      } else {
        setLookup((current) =>
          current
            ? {
                ...current,
                candidates: current.candidates.map((item) =>
                  item.email === candidate.email
                    ? { ...item, id: payload.candidate_id }
                    : item,
                ),
              }
            : current,
        );
      }
      await onUpdated();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this email.",
      );
    } finally {
      setSavingCandidate("");
    }
  }

  async function updateImportedProspect(
    id: string,
    changes: {
      find_email_status: string;
      business_email?: string;
      email_status?: string;
    },
  ) {
    const response = await fetch("/api/lead-import", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "Unable to update the imported lead.");
    }
  }

  const queuedProspects = prospects.filter(
    (prospect) =>
      prospect.find_email_status !== "approved" &&
      !(
        prospect.business_email &&
        prospect.email_status.trim().toLowerCase() === "verified"
      ),
  );

  return (
    <section className="panel imported-queue">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Find-email queue</span>
          <h2>{queuedProspects.length} leads need email finding</h2>
        </div>
        <span className="privacy-chip">
          {queuedProspects.length} in queue
        </span>
      </div>
      <div className="imported-list">
        {queuedProspects.slice(0, 50).map((prospect) => (
          <div className="imported-row" key={prospect.id}>
            <span className="prospect-avatar small">
              {initials(prospect.contact_name)}
            </span>
            <span>
              <strong>{prospect.contact_name}</strong>
              <small>{prospect.job_title || "Role not supplied"}</small>
            </span>
            <span>
              <strong>{prospect.company_name}</strong>
              <small>{prospect.company_website.replace(/^https?:\/\//, "")}</small>
            </span>
            <span className={`email-queue-status ${prospect.find_email_status}`}>
              {prospect.business_email
                ? `${prospect.business_email} · ${prospect.email_status}`
                : prospect.find_email_status.replaceAll("_", " ")}
            </span>
            <button
              className="research-button"
              disabled={findingId === prospect.id}
              onClick={() => findEmail(prospect)}
            >
              {findingId === prospect.id
                ? "Finding…"
                : "Find email"}
            </button>
          </div>
        ))}
        {!queuedProspects.length && (
          <div className="empty-table">
            All imported contacts are spreadsheet-verified, or no leads have been uploaded yet.
          </div>
        )}
      </div>

      {lookup && activeProspect && (
        <div className="imported-candidate-review">
          <header>
            <span>
              <small>Email candidates for</small>
              <strong>{activeProspect.contact_name}</strong>
            </span>
            <button
              className="text-button"
              onClick={() => {
                setLookup(null);
                setActiveProspect(null);
              }}
            >
              Close
            </button>
          </header>
          {lookup.source_discovery && (
            <p className="source-discovery-note">
              {lookup.source_discovery.confirmed_on_company_site
                ? "Employment confirmed on the company website."
                : "Using the supplied person source and company email patterns."}{" "}
              {lookup.source_discovery.inspected_pages.length} public page
              {lookup.source_discovery.inspected_pages.length === 1 ? "" : "s"} checked.
            </p>
          )}
          {lookup.optimization && (
            <p className="source-discovery-note">
              {lookup.optimization.finder_skipped_reason === "published_email"
                ? "Exact public email found; no finder credit used."
                : lookup.optimization.finder_skipped_reason ===
                    "company_pattern"
                  ? "Reused this company’s saved email pattern before using a finder."
                  : "Free public and pattern checks ran before paid-credit providers."}{" "}
              {lookup.optimization.verification_cache_hits > 0 &&
                "A recent verification result was reused."}
            </p>
          )}
          <div className="candidate-list">
            {lookup.candidates.map((candidate) => (
              <article
                className={
                  candidate.campaign_eligible
                    ? "candidate-card eligible"
                    : "candidate-card"
                }
                key={candidate.email}
              >
                <div className="candidate-heading">
                  <div>
                    <strong>{candidate.email}</strong>
                    <small>
                      {candidate.origin} / {candidate.status} /{" "}
                      {providerLabel(candidate.provider)}
                    </small>
                  </div>
                  <span>{candidate.confidence}%</span>
                </div>
                <p>{candidate.reason}</p>
                <div className="candidate-flags">
                  <span>{candidate.mx_found ? "MX found" : "No MX"}</span>
                  {candidate.catch_all && <span>Catch-all</span>}
                  {candidate.role_address && <span>Role address</span>}
                  {candidate.campaign_eligible && (
                    <strong>Campaign eligible</strong>
                  )}
                </div>
                <footer>
                  <button
                    className="secondary-button"
                    disabled={
                      Boolean(candidate.id) ||
                      savingCandidate === `save:${candidate.email}`
                    }
                    onClick={() => saveCandidate(candidate, "save")}
                  >
                    {candidate.id ? "Saved" : "Save candidate"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      !candidate.campaign_eligible ||
                      savingCandidate === `approve:${candidate.email}`
                    }
                    onClick={() => saveCandidate(candidate, "approve")}
                  >
                    Approve & add contact
                  </button>
                </footer>
              </article>
            ))}
            {!lookup.candidates.length && (
              <p className="candidate-empty">
                No safe candidate was found. Keep this lead queued for manual review.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CandidateVerificationQueue({
  candidates,
  setError,
  setNotice,
  onUpdated,
}: {
  candidates: SavedContactCandidate[];
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [workingId, setWorkingId] = useState("");

  async function approveCandidate(candidate: SavedContactCandidate) {
    if (!candidate.campaign_eligible) return;
    setWorkingId(`approve:${candidate.id}`);
    setError("");
    try {
      const response = await fetch("/api/contact-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", ...candidate }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to approve this email.");
      setNotice(
        `${candidate.email} was approved and moved to campaign recipients.`,
      );
      await onUpdated();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Unable to approve this email.",
      );
    } finally {
      setWorkingId("");
    }
  }

  async function recheckCandidate(candidate: SavedContactCandidate) {
    setWorkingId(`recheck:${candidate.id}`);
    setError("");
    try {
      const response = await fetch("/api/contact-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_name: candidate.person_name,
          role: candidate.role,
          person_source_url: candidate.person_source_url,
          company_name: candidate.company_name,
          website: candidate.website,
          evidence_urls: candidate.evidence_urls,
        }),
      });
      const lookup = await response.json();
      if (!response.ok)
        throw new Error(lookup.error || "Unable to re-check this email.");
      const refreshed =
        lookup.candidates?.find(
          (item: ContactCandidate) => item.email === candidate.email,
        ) || lookup.candidates?.[0];
      if (!refreshed)
        throw new Error("No email candidate was found during the new check.");

      const saveResponse = await fetch("/api/contact-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          ...refreshed,
          website: lookup.website || candidate.website,
          company_name: lookup.company_name || candidate.company_name,
          person_name: lookup.person || candidate.person_name,
          role: lookup.role || candidate.role,
          person_source_url:
            lookup.person_source_url || candidate.person_source_url,
        }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok)
        throw new Error(saved.error || "Unable to save the new verification.");
      setNotice(
        refreshed.campaign_eligible
          ? `${refreshed.email} is now eligible for approval.`
          : `${refreshed.email} was re-checked and remains ${refreshed.status}${refreshed.catch_all ? " / catch-all" : ""}.`,
      );
      await onUpdated();
    } catch (recheckError) {
      setError(
        recheckError instanceof Error
          ? recheckError.message
          : "Unable to re-check this email.",
      );
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section className="panel candidate-verification-queue">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Email verification queue</span>
          <h2>{candidates.length} saved candidate{candidates.length === 1 ? "" : "s"}</h2>
        </div>
        <span className="privacy-chip">Review before outreach</span>
      </div>
      <p className="verification-queue-copy">
        Saved candidates stay here until they pass verification and you approve
        them. Catch-all or risky addresses are never added to campaigns
        automatically.
      </p>
      <div className="verification-list">
        {candidates.map((candidate) => (
          <article className="verification-row" key={candidate.id}>
            <span className="prospect-avatar small">
              {initials(candidate.person_name)}
            </span>
            <span className="verification-person">
              <strong>{candidate.person_name}</strong>
              <small>
                {candidate.role || "Role not supplied"} · {candidate.company_name}
              </small>
            </span>
            <span className="verification-email">
              <strong>{candidate.email}</strong>
              <small>
                {providerLabel(candidate.provider)} · {candidate.confidence}% confidence
              </small>
            </span>
            <span
              className={`verification-state ${
                candidate.campaign_eligible ? "eligible" : "review"
              }`}
            >
              {candidate.campaign_eligible
                ? "Ready to approve"
                : candidate.catch_all
                  ? "Catch-all — review"
                  : candidate.status.replaceAll("_", " ")}
            </span>
            <span className="verification-actions">
              <button
                className="secondary-button"
                disabled={Boolean(workingId)}
                onClick={() => recheckCandidate(candidate)}
              >
                {workingId === `recheck:${candidate.id}`
                  ? "Checking…"
                  : "Re-check"}
              </button>
              <button
                className="primary-button"
                disabled={!candidate.campaign_eligible || Boolean(workingId)}
                title={
                  candidate.campaign_eligible
                    ? "Approve this verified address"
                    : "This address must pass verification before approval"
                }
                onClick={() => approveCandidate(candidate)}
              >
                {workingId === `approve:${candidate.id}`
                  ? "Approving…"
                  : "Approve"}
              </button>
            </span>
          </article>
        ))}
        {!candidates.length && (
          <div className="empty-table">
            Candidates saved after Find email will appear here for verification.
          </div>
        )}
      </div>
    </section>
  );
}

function LeadLibrary({
  prospects,
  importedProspects,
  contactCandidates,
  leads,
  draft,
  setDraft,
  batchLabel,
  setBatchLabel,
  existingLabels,
  onImport,
  onFile,
  saving,
  onDelete,
  setError,
  setNotice,
  onImported,
}: {
  prospects: Prospect[];
  importedProspects: ImportedProspect[];
  contactCandidates: SavedContactCandidate[];
  leads: Lead[];
  draft: string;
  setDraft: (value: string) => void;
  batchLabel: string;
  setBatchLabel: (value: string) => void;
  existingLabels: string[];
  onImport: (event: FormEvent) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  saving: boolean;
  onDelete: (id: string) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onImported: () => Promise<void>;
}) {
  async function removeProspect(prospect: Prospect) {
    if (!prospect.id) return;
    const response = await fetch(
      `/api/prospects?id=${encodeURIComponent(prospect.id)}`,
      { method: "DELETE" },
    );
    if (response.ok) onDelete(prospect.id);
    else {
      const payload = await response.json();
      setError(payload.error ?? "Unable to remove prospect");
    }
  }

  return (
    <div className="library-layout">
      <ResearchLeadImporter
        setError={setError}
        setNotice={setNotice}
        onImported={onImported}
        existingLabels={existingLabels}
      />
      <ImportedProspectQueue
        prospects={importedProspects}
        setError={setError}
        setNotice={setNotice}
        onUpdated={onImported}
      />
      <CandidateVerificationQueue
        candidates={contactCandidates}
        setError={setError}
        setNotice={setNotice}
        onUpdated={onImported}
      />
      <section className="panel saved-prospects">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Prospect records</span>
            <h2>{prospects.length} saved from approved sources</h2>
          </div>
          <span className="privacy-chip">Source-separated</span>
        </div>
        <div className="saved-list">
          {prospects.map((prospect) => (
            <div className="saved-row" key={prospect.source_member_id}>
              <span className="prospect-avatar small">
                {initials(prospect.full_name)}
              </span>
              <span>
                <strong>{prospect.full_name}</strong>
                <small>{prospect.headline || prospect.job_title}</small>
              </span>
              <span>{prospect.company}</span>
              <span>{prospect.location}</span>
              <button
                className="text-button danger"
                onClick={() => removeProspect(prospect)}
              >
                Remove
              </button>
            </div>
          ))}
          {!prospects.length && (
            <div className="empty-table">
              Search and save a prospect to build your library.
            </div>
          )}
        </div>
      </section>

      <section className="library-bottom">
        <article className="panel import-panel">
          <span className="eyebrow">Email-ready contacts</span>
          <h2>Add validated contact data</h2>
          <p>
            Paste one person per line as email, first name, last name, company,
            verification status—or load a CSV. Verified contacts are immediately
            eligible; blank or unverified statuses enter the validation queue.
          </p>
          <form onSubmit={onImport}>
            <label className="batch-label-field">
              Batch label
              <input
                list="email-ready-labels"
                value={batchLabel}
                onChange={(event) => setBatchLabel(event.target.value)}
                placeholder="Required for pasted contacts"
                required
              />
              <datalist id="email-ready-labels">
                {existingLabels.map((label) => (
                  <option value={label} key={label} />
                ))}
              </datalist>
            </label>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                "alex@example.com, Alex, Morgan, Northstar, Verified\nsam@example.com, Sam, Lee, Acme, Unverified"
              }
            />
            <div className="import-actions">
              <label className="file-button">
                Choose CSV
                <input
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  onChange={onFile}
                />
              </label>
              <button className="primary-button" disabled={saving}>
                {saving ? "Importing…" : "Import contacts"}
              </button>
            </div>
          </form>
        </article>
        <article className="panel email-ready-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Campaign recipients</span>
              <h2>{leads.length} email contacts</h2>
            </div>
          </div>
          <div className="lead-list">
            {leads.slice(0, 8).map((lead) => (
              <div className="lead-row" key={lead.id}>
                <span className="lead-avatar">
                  {(lead.first_name?.[0] ?? lead.email[0]).toUpperCase()}
                </span>
                <span className="lead-identity">
                  <strong>
                    {[lead.first_name, lead.last_name]
                      .filter(Boolean)
                      .join(" ") || lead.email}
                  </strong>
                  <small>{lead.email}</small>
                </span>
                <span className="company">{lead.company ?? "Independent"}</span>
                <span className={`validation ${lead.validation_status}`}>
                  {lead.validation_status}
                </span>
                <span className="batch-chip">{lead.batch_label || "Unlabelled"}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function Overview({
  data,
  metrics,
  onNavigate,
  onCreate,
}: {
  data: DashboardData;
  metrics: {
    prospects: number;
    emailReady: number;
    sent: number;
    replyRate: number;
  };
  onNavigate: (tab: Tab) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <section className="metric-grid">
        <Metric label="Saved prospects" value={metrics.prospects} detail="Source-attributed" />
        <Metric label="Email-ready" value={metrics.emailReady} detail="Validated contacts" />
        <Metric label="Emails sent" value={metrics.sent} detail="Across all campaigns" />
        <Metric label="Reply rate" value={metrics.replyRate} detail="All-time performance" accent suffix="%" />
      </section>
      <section className="content-grid">
        <article className="panel overview-action">
          <span className="eyebrow">Start with your audience</span>
          <h2>Find a focused list, then build the right message.</h2>
          <p>
            Search approved professional data by role, industry, company, and
            location. Save only the people who fit.
          </p>
          <button className="primary-button" onClick={() => onNavigate("finder")}>
            Find leads
          </button>
        </article>
        <article className="panel overview-action soft">
          <span className="eyebrow">Ready for outreach</span>
          <h2>{data.campaigns.length} campaigns in your workspace.</h2>
          <p>
            Compose a personal sequence for validated email contacts and hand it
            off to the local sender.
          </p>
          <button className="secondary-button" onClick={onCreate}>
            New campaign
          </button>
        </article>
      </section>
    </>
  );
}

function CampaignStats({ data }: { data: DashboardData }) {
  const latestByCampaign = new Map<string, WorkerReport>();
  for (const report of data.workerReports) {
    if (!latestByCampaign.has(report.campaign_id)) {
      latestByCampaign.set(report.campaign_id, report);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayReports = data.workerReports.filter(
    (report) => report.report_date === today,
  );
  const sentToday = todayReports.reduce(
    (total, report) => total + report.sent_today,
    0,
  );
  const bouncedToday = todayReports.reduce(
    (total, report) => total + report.bounced_today,
    0,
  );
  const repliedToday = todayReports.reduce(
    (total, report) => total + report.replied_today,
    0,
  );
  const errorsToday = todayReports.reduce(
    (total, report) => total + report.errors_today,
    0,
  );
  const reached = data.assignments.filter((assignment) =>
    ["sent", "replied", "bounced", "unsubscribed"].includes(assignment.status),
  ).length;
  const replied = data.assignments.filter(
    (assignment) => assignment.status === "replied",
  ).length;
  const bounced = data.assignments.filter(
    (assignment) => assignment.status === "bounced",
  ).length;
  const queued = data.assignments.filter(
    (assignment) =>
      assignment.status === "pending" ||
      (assignment.status === "sent" && Boolean(assignment.next_send_at)),
  ).length;
  const deliveries = data.campaigns.reduce((total, campaign) => {
    const reportCount = latestByCampaign.get(campaign.id)?.deliveries_total || 0;
    const loadedLogCount = data.logs.filter(
      (log) => log.campaign_id === campaign.id && log.status === "sent",
    ).length;
    return total + Math.max(reportCount, loadedLogCount);
  }, 0);
  const replyRate = reached ? Math.round((replied / reached) * 1000) / 10 : 0;
  const bounceRate = reached ? Math.round((bounced / reached) * 1000) / 10 : 0;
  const healthyWorkers = Array.from(latestByCampaign.values()).filter(
    (report) => workerHealth(report).level === "healthy",
  ).length;

  const insight =
    bounceRate >= 5
      ? "Bounce rate is above 5%. Tighten verification and suppress risky domains before adding volume."
      : replyRate < 2 && reached >= 20
        ? "Delivery quality is stable, but replies are low. Test a sharper subject line and a more specific first paragraph."
        : reached
          ? "Delivery quality is in a healthy range. Keep comparing reply rate by campaign before scaling volume."
          : "Once sending begins, Relay will surface delivery quality and reply-rate guidance here.";

  return (
    <div className="stats-page">
      <section className="metric-grid stats-metric-grid">
        <Metric label="Sent today" value={sentToday} detail="Accepted deliveries" accent />
        <Metric label="Replies today" value={repliedToday} detail="Follow-ups stopped" />
        <Metric label="Bounced today" value={bouncedToday} detail="Addresses restricted" />
        <Metric label="Worker errors" value={errorsToday} detail="Retries or uncertain sends" />
      </section>

      <section className="stats-overview-grid">
        <article className="panel stats-scorecard">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Overall tally</span>
              <h2>Campaign performance</h2>
            </div>
            <span className="stats-date">UTC day · {today}</span>
          </div>
          <div className="stats-kpis">
            <StatsKpi label="All deliveries" value={deliveries} />
            <StatsKpi label="Recipients reached" value={reached} />
            <StatsKpi label="Reply rate" value={replyRate} suffix="%" />
            <StatsKpi label="Bounce rate" value={bounceRate} suffix="%" />
            <StatsKpi label="Still queued" value={queued} />
            <StatsKpi
              label="Workers reporting"
              value={healthyWorkers}
              suffix={`/${data.campaigns.filter((campaign) => campaign.status === "running").length}`}
            />
          </div>
        </article>

        <article className={`panel stats-insight ${bounceRate >= 5 ? "warning" : ""}`}>
          <span className="eyebrow">What to improve</span>
          <h2>{bounceRate >= 5 ? "Review list quality" : "Performance note"}</h2>
          <p>{insight}</p>
          <small>
            Reply rate uses recipients reached. Bounce rate uses confirmed hard
            bounces, and open tracking is intentionally not included.
          </small>
        </article>
      </section>

      <section className="panel stats-campaign-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Campaign tally</span>
            <h2>Performance by campaign</h2>
          </div>
          <span className="stats-refresh-note">Workers report every 15 minutes</span>
        </div>
        <div className="stats-campaign-list">
          {data.campaigns.map((campaign) => {
            const assignments = data.assignments.filter(
              (assignment) => assignment.campaign_id === campaign.id,
            );
            const campaignReached = assignments.filter((assignment) =>
              ["sent", "replied", "bounced", "unsubscribed"].includes(
                assignment.status,
              ),
            ).length;
            const campaignReplies = assignments.filter(
              (assignment) => assignment.status === "replied",
            ).length;
            const campaignBounces = assignments.filter(
              (assignment) => assignment.status === "bounced",
            ).length;
            const report = latestByCampaign.get(campaign.id);
            const health = workerHealth(report, campaign.status);
            const campaignDeliveries = Math.max(
              report?.deliveries_total || 0,
              data.logs.filter(
                (log) => log.campaign_id === campaign.id && log.status === "sent",
              ).length,
            );
            const campaignReplyRate = campaignReached
              ? Math.round((campaignReplies / campaignReached) * 1000) / 10
              : 0;
            const campaignBounceRate = campaignReached
              ? Math.round((campaignBounces / campaignReached) * 1000) / 10
              : 0;
            return (
              <article className="stats-campaign-row" key={campaign.id}>
                <div className="stats-campaign-name">
                  <strong>{campaign.title}</strong>
                  <small>
                    {report?.worker_kind === "gmail"
                      ? "Gmail worker"
                      : report?.worker_kind === "lark_smtp"
                        ? "Lark SMTP worker"
                        : campaign.status === "completed"
                          ? "Historical campaign"
                          : campaign.sender_email || "Worker not reported yet"}
                  </small>
                </div>
                <StatsKpi label="Today" value={report?.sent_today || 0} />
                <StatsKpi label="Deliveries" value={campaignDeliveries} />
                <StatsKpi
                  label="Reached"
                  value={campaignReached}
                  suffix={`/${assignments.length}`}
                />
                <StatsKpi label="Replies" value={campaignReplyRate} suffix="%" />
                <StatsKpi label="Bounces" value={campaignBounceRate} suffix="%" />
                <div className="worker-health">
                  <span className={`health-dot ${health.level}`} />
                  <span>
                    <strong>{health.label}</strong>
                    <small>
                      {report
                        ? `Last update ${formatRelativeTime(report.last_seen_at)}`
                        : campaign.status === "completed"
                          ? "Stored campaign totals"
                          : "Waiting for first report"}
                    </small>
                  </span>
                </div>
              </article>
            );
          })}
          {!data.campaigns.length && (
            <p className="empty-copy">No campaigns are available to report yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatsKpi({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="stats-kpi">
      <span>{label}</span>
      <strong>
        {value}
        {suffix}
      </strong>
    </div>
  );
}

function workerHealth(report?: WorkerReport, campaignStatus?: string) {
  if (!report && campaignStatus === "completed") {
    return { level: "complete", label: "Campaign complete" };
  }
  if (!report && ["draft", "staged", "scheduled"].includes(campaignStatus || "")) {
    return { level: "complete", label: "Not started" };
  }
  if (!report) return { level: "missing", label: "Not reporting" };
  if (["completed", "stopped"].includes(report.worker_status)) {
    return { level: "complete", label: report.worker_status };
  }
  const ageMinutes = (Date.now() - new Date(report.last_seen_at).getTime()) / 60_000;
  if (ageMinutes <= 30) return { level: "healthy", label: "Reporting" };
  if (ageMinutes <= 26 * 60) return { level: "delayed", label: "Update delayed" };
  return { level: "missing", label: "Worker offline" };
}

function Campaigns({
  data,
  onCreate,
  onUpdated,
  setError,
  setNotice,
}: {
  data: DashboardData;
  onCreate: () => void;
  onUpdated: () => Promise<void>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [copiedCampaignId, setCopiedCampaignId] = useState<string | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(
    null,
  );
  const [removingKey, setRemovingKey] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(
    null,
  );

  async function copyCampaignId(campaignId: string) {
    await navigator.clipboard.writeText(campaignId);
    setCopiedCampaignId(campaignId);
    window.setTimeout(() => {
      setCopiedCampaignId((current) =>
        current === campaignId ? null : current,
      );
    }, 2000);
  }

  async function removeRecipient(
    campaignId: string,
    leadId: string,
    email: string,
  ) {
    const key = `${campaignId}:${leadId}`;
    setRemovingKey(key);
    setError("");
    try {
      const response = await fetch("/api/campaign-recipients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, lead_id: leadId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to remove this recipient.");
      }
      setNotice(
        payload.changed
          ? `${email} was removed from this campaign. Active workers will stop before the next send.`
          : `${email} is already stopped with status ${payload.status}.`,
      );
      await onUpdated();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove this recipient.",
      );
    } finally {
      setRemovingKey("");
    }
  }

  async function deleteCampaign(campaign: Campaign) {
    setDeletingCampaignId(campaign.id);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns?id=${encodeURIComponent(campaign.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to delete this campaign.");
      }
      setDeleteConfirmId(null);
      setExpandedCampaignId((current) =>
        current === campaign.id ? null : current,
      );
      setNotice(
        `Campaign “${campaign.title}” was deleted. Workers will skip it on their next database check.`,
      );
      await onUpdated();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete this campaign.",
      );
    } finally {
      setDeletingCampaignId(null);
    }
  }

  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Campaign library</span>
          <h2>Every outreach motion</h2>
        </div>
        <div>
          <a className="secondary-button" href={`${process.env.NEXT_PUBLIC_EMAIL_ENGINE_URL || "http://localhost:8000"}/campaigns/safety/dashboard`} target="_blank" rel="noreferrer">
            Delivery safety
          </a>
          <button className="secondary-button" onClick={onCreate}>
            New campaign
          </button>
        </div>
      </div>
      <div className="data-table">
        <div className="table-row table-head">
          <span>Campaign</span>
          <span>Recipients</span>
          <span>Accepted</span>
          <span>Status</span>
          <span>Created</span>
        </div>
        {data.campaigns.map((campaign) => {
          const assignments = data.assignments.filter(
            (assignment) => assignment.campaign_id === campaign.id,
          );
          const activeAssignments = assignments.filter((assignment) =>
            ["pending", "sent"].includes(assignment.status),
          );
          const expanded = expandedCampaignId === campaign.id;
          return (
            <Fragment key={campaign.id}>
              <div className="table-row">
                <span>
                  <strong>{campaign.title}</strong>
                  <small>
                    {campaign.subject_template} ·{" "}
                    {
                      data.steps.filter(
                        (step) => step.campaign_id === campaign.id,
                      ).length
                    }{" "}
                    follow-ups
                  </small>
                  <button
                    type="button"
                    className="text-button campaign-id-button"
                    onClick={() => copyCampaignId(campaign.id)}
                    aria-label={`Copy campaign ID for ${campaign.title}`}
                  >
                    {copiedCampaignId === campaign.id
                      ? "Copied!"
                      : "Copy campaign ID"}
                  </button>
                  <button
                    type="button"
                    className="text-button campaign-id-button"
                    onClick={() =>
                      setExpandedCampaignId(expanded ? null : campaign.id)
                    }
                  >
                    {expanded ? "Hide recipients" : "Manage recipients"}
                  </button>
                  <button
                    type="button"
                    className="text-button danger campaign-id-button"
                    disabled={Boolean(deletingCampaignId)}
                    onClick={() => setDeleteConfirmId(campaign.id)}
                  >
                    Delete campaign
                  </button>
                  {deleteConfirmId === campaign.id && (
                    <span className="campaign-delete-confirm" role="alert">
                      <strong>Delete this campaign permanently?</strong>
                      <small>
                        Its recipients, sequence, delivery history, and worker
                        reports will also be removed. Messages already sent cannot
                        be recalled.
                      </small>
                      <span>
                        <button
                          type="button"
                          className="secondary-button danger-button"
                          disabled={Boolean(deletingCampaignId)}
                          onClick={() => void deleteCampaign(campaign)}
                        >
                          {deletingCampaignId === campaign.id
                            ? "Deleting…"
                            : "Delete permanently"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={Boolean(deletingCampaignId)}
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    </span>
                  )}
                </span>
                <span>
                  {activeAssignments.length} active / {assignments.length} total
                </span>
                <span>
                  {
                    data.logs.filter((log) => log.campaign_id === campaign.id)
                      .length
                  }
                </span>
                <span>
                  <span className={`status-pill ${campaign.status}`}>
                    {campaign.status}
                  </span>
                </span>
                <span>{formatDate(campaign.created_at)}</span>
              </div>
              {expanded && (
                <div className="campaign-recipient-panel">
                  <div className="campaign-recipient-heading">
                    <div>
                      <strong>{campaign.title} recipients</strong>
                      <small>
                        Removing a recipient stops initial email and follow-up
                        work.
                      </small>
                    </div>
                    <span>{assignments.length} assigned</span>
                  </div>
                  <div className="campaign-recipient-list">
                    {assignments.map((assignment) => {
                      const lead = data.leads.find(
                        (item) => item.id === assignment.lead_id,
                      );
                      const key = `${campaign.id}:${assignment.lead_id}`;
                      const canRemove = ["pending", "sent"].includes(
                        assignment.status,
                      );
                      return (
                        <div className="campaign-recipient-row" key={key}>
                          <span>
                            <strong>
                              {[lead?.first_name, lead?.last_name]
                                .filter(Boolean)
                                .join(" ") || lead?.email || assignment.lead_id}
                            </strong>
                            <small>{lead?.email || assignment.lead_id}</small>
                          </span>
                          <span className={`status-pill ${assignment.status}`}>
                            {assignment.status === "skipped"
                              ? "removed"
                              : assignment.status}
                          </span>
                          <button
                            type="button"
                            className="secondary-button danger-button"
                            disabled={!canRemove || Boolean(removingKey)}
                            onClick={() =>
                              removeRecipient(
                                campaign.id,
                                assignment.lead_id,
                                lead?.email || "Recipient",
                              )
                            }
                          >
                            {removingKey === key
                              ? "Removing…"
                              : canRemove
                                ? "Remove from campaign"
                                : "Stopped"}
                          </button>
                        </div>
                      );
                    })}
                    {!assignments.length && (
                      <p className="empty-copy">No recipients are assigned.</p>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        {!data.campaigns.length && (
          <div className="empty-table">No campaigns yet.</div>
        )}
      </div>
    </section>
  );
}

function CampaignComposer({
  templates,
  selectedTemplateId,
  setSelectedTemplateId,
  templateName,
  setTemplateName,
  templateSaving,
  onSaveTemplate,
  eligibleLeads,
  sentLeadIds,
  existingLabels,
  selectedLeadIds,
  setSelectedLeadIds,
  title,
  setTitle,
  senderEmail,
  setSenderEmail,
  subject,
  setSubject,
  body,
  setBody,
  initialSendAt,
  setInitialSendAt,
  followups,
  setFollowups,
  saving,
  onSubmit,
  onClose,
}: {
  templates: MessageTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  templateName: string;
  setTemplateName: (value: string) => void;
  templateSaving: boolean;
  onSaveTemplate: () => Promise<MessageTemplate | null>;
  eligibleLeads: Lead[];
  sentLeadIds: string[];
  existingLabels: string[];
  selectedLeadIds: string[];
  setSelectedLeadIds: (ids: string[]) => void;
  title: string;
  setTitle: (value: string) => void;
  senderEmail: string;
  setSenderEmail: (value: string) => void;
  subject: string;
  setSubject: (value: string) => void;
  body: string;
  setBody: (value: string) => void;
  initialSendAt: string;
  setInitialSendAt: (value: string) => void;
  followups: Array<{ delay_days: number; body_template: string }>;
  setFollowups: (
    value: Array<{ delay_days: number; body_template: string }>,
  ) => void;
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"template" | "audience">("template");
  const [labelFilter, setLabelFilter] = useState("all");
  const [hidePreviouslySent, setHidePreviouslySent] = useState(true);
  const [previewStep, setPreviewStep] = useState(0);
  const sentSet = new Set(sentLeadIds);
  const selectedTemplate = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const labelFilteredLeads = eligibleLeads.filter(
    (lead) => labelFilter === "all" || lead.batch_label === labelFilter,
  );
  const visibleLeads = hidePreviouslySent
    ? labelFilteredLeads.filter((lead) => !sentSet.has(lead.id))
    : labelFilteredLeads;
  const selectableLeadIds = labelFilteredLeads
    .filter((lead) => !sentSet.has(lead.id))
    .map((lead) => lead.id);
  const previewLead =
    eligibleLeads.find((lead) => selectedLeadIds.includes(lead.id)) ||
    eligibleLeads[0];
  const previewMessages = [
    { label: "Email 1", delay: "Initial email", body },
    ...followups.map((followup, index) => ({
      label: `Follow-up ${index + 1}`,
      delay: `Day ${followup.delay_days}`,
      body: followup.body_template,
    })),
  ];
  const activePreviewIndex = Math.min(
    previewStep,
    Math.max(0, previewMessages.length - 1),
  );
  const activePreview = previewMessages[activePreviewIndex];
  const previewRecipient = {
    firstName: previewLead?.first_name,
    company: previewLead?.company,
  };
  const previewSubject = personalizeEmailHtml(
    activePreviewIndex > 0 && !subject.toLowerCase().startsWith("re:")
      ? `Re: ${subject}`
      : subject,
    previewRecipient,
  );
  const previewBody = personalizeEmailHtml(
    ensureDefaultEmailFooter(activePreview.body),
    previewRecipient,
  );
  const previewRecipientName =
    [previewLead?.first_name, previewLead?.last_name].filter(Boolean).join(" ") ||
    "Jordan Lee";
  const previewRecipientEmail = previewLead?.email || "jordan@example.com";

  function chooseTemplate(template: MessageTemplate) {
    setSelectedTemplateId(template.id);
    setTemplateName(template.name);
    setSubject(template.subject_template);
    setBody(stripManagedEmailFooter(template.body_template));
    setFollowups(
      (template.followups || []).map((followup) => ({
        ...followup,
        body_template: stripManagedEmailFooter(followup.body_template),
      })),
    );
    setSelectedLeadIds(
      selectedLeadIds.filter((leadId) => !sentLeadIds.includes(leadId)),
    );
  }

  async function saveAndContinue() {
    const saved = await onSaveTemplate();
    if (saved) setStage("audience");
  }

  function togglePreviouslySent() {
    const next = !hidePreviouslySent;
    setHidePreviouslySent(next);
    if (next) {
      setSelectedLeadIds(
        selectedLeadIds.filter((leadId) => !sentLeadIds.includes(leadId)),
      );
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="composer" role="dialog" aria-modal="true">
        <div className="composer-header">
          <div>
            <span className="eyebrow">Email campaigns</span>
            <h2>{stage === "template" ? "Choose your message" : "Choose your audience"}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="composer-stages" aria-label="Campaign setup progress">
          <span className={stage === "template" ? "active" : "complete"}>1. Message template</span>
          <span className={stage === "audience" ? "active" : ""}>2. Audience & schedule</span>
        </div>
        <form
          onSubmit={(event) => {
            if (stage === "template") {
              event.preventDefault();
              void saveAndContinue();
              return;
            }
            onSubmit(event);
          }}
        >
          {stage === "template" ? (
            <div className="template-stage">
              <section className="template-library">
                <div className="sequence-heading">
                  <div>
                    <strong>Saved templates</strong>
                    <span>Select a message before choosing recipients.</span>
                  </div>
                  <span className="timezone-chip">{templates.length} saved</span>
                </div>
                <div className="template-card-grid">
                  {templates.map((template) => (
                    <button
                      type="button"
                      className={
                        selectedTemplateId === template.id
                          ? "template-card selected"
                          : "template-card"
                      }
                      key={template.id}
                      onClick={() => chooseTemplate(template)}
                    >
                      <strong>{template.name}</strong>
                      <span>{template.subject_template}</span>
                      <small>{template.followups?.length || 0} follow-ups</small>
                    </button>
                  ))}
                  {!templates.length && (
                    <p className="empty-copy">Create your first reusable message below.</p>
                  )}
                </div>
                {selectedTemplate && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setStage("audience")}
                  >
                    Continue with {selectedTemplate.name}
                  </button>
                )}
              </section>
              <div className="template-workbench">
                <section className="template-editor">
                  <span className="eyebrow">New reusable template</span>
                  <label>
                    Template name
                    <input
                      value={templateName}
                      onChange={(event) => {
                        setSelectedTemplateId("");
                        setTemplateName(event.target.value);
                      }}
                      placeholder="Bookkeeping introduction"
                    />
                  </label>
                  <label>
                    Subject
                    <input
                      value={subject}
                      onChange={(event) => {
                        setSelectedTemplateId("");
                        setSubject(event.target.value);
                      }}
                      required
                    />
                  </label>
                  <div className="editor-field">
                    <span>Message</span>
                    <RichTextEditor
                      value={body}
                      ariaLabel="Initial email message"
                      placeholder="Write your first email…"
                      onChange={(value) => {
                        setSelectedTemplateId("");
                        setBody(value);
                      }}
                      onFocus={() => setPreviewStep(0)}
                    />
                  </div>
                  <section className="sequence-builder">
                    <div className="sequence-heading">
                      <div>
                        <strong>Follow-up messages</strong>
                        <span>Each message stays in the same email thread.</span>
                      </div>
                    </div>
                    {followups.map((followup, index) => (
                      <article className="followup-card" key={index}>
                        <div className="followup-title">
                          <strong>Follow-up {index + 1}</strong>
                          <button
                            type="button"
                            className="text-button danger"
                            onClick={() => {
                              setSelectedTemplateId("");
                              setFollowups(
                                followups.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              );
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        <label>
                          Days after the first email
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={followup.delay_days}
                            onChange={(event) => {
                              setSelectedTemplateId("");
                              setFollowups(
                                followups.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        delay_days: Number(event.target.value),
                                      }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </label>
                        <div className="editor-field">
                          <span>Message</span>
                          <RichTextEditor
                            value={followup.body_template}
                            ariaLabel={`Follow-up ${index + 1} message`}
                            placeholder="Write your follow-up…"
                            onChange={(value) => {
                              setSelectedTemplateId("");
                              setFollowups(
                                followups.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, body_template: value }
                                    : item,
                                ),
                              );
                            }}
                            onFocus={() => setPreviewStep(index + 1)}
                          />
                        </div>
                      </article>
                    ))}
                    <button
                      type="button"
                      className="secondary-button add-followup"
                      onClick={() => {
                        setSelectedTemplateId("");
                        setFollowups([
                          ...followups,
                          {
                            delay_days:
                              Math.max(
                                0,
                                ...followups.map((item) => item.delay_days),
                              ) + 3,
                            body_template:
                              "<p>Hi {{first_name}},</p><p>Wanted to follow up once more in case this is useful for {{company}}.</p>",
                          },
                        ]);
                        setPreviewStep(followups.length + 1);
                      }}
                    >
                      + Add follow-up
                    </button>
                  </section>
                  <div className="template-save-row">
                    <p>
                      Personalize with <code>{"{{first_name}}"}</code> and{" "}
                      <code>{"{{company}}"}</code>. Your fixed footer is added
                      automatically.
                    </p>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={templateSaving || !templateName.trim()}
                      onClick={saveAndContinue}
                    >
                      {templateSaving ? "Saving…" : "Save template & continue"}
                    </button>
                  </div>
                </section>
                <section className="email-preview-panel" aria-label="Email preview">
                  <div className="sequence-heading">
                    <div>
                      <strong>Email preview</strong>
                      <span>Final message with personalization and footer.</span>
                    </div>
                    <span className="timezone-chip">Live</span>
                  </div>
                  <div className="preview-sequence-tabs" role="tablist" aria-label="Sequence preview">
                    {previewMessages.map((message, index) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activePreviewIndex === index}
                        className={activePreviewIndex === index ? "active" : ""}
                        onClick={() => setPreviewStep(index)}
                        key={`${message.label}-${index}`}
                      >
                        <strong>{message.label}</strong>
                        <span>{message.delay}</span>
                      </button>
                    ))}
                  </div>
                  <div className="email-preview-window">
                    <div className="email-preview-header">
                      <span>
                        <small>From</small>
                        <strong>Anthony · AI Accounting Agency</strong>
                      </span>
                      <span>
                        <small>To</small>
                        <strong>
                          {previewRecipientName} &lt;{previewRecipientEmail}&gt;
                        </strong>
                      </span>
                      <span>
                        <small>Subject</small>
                        <strong>{previewSubject || "Your email subject"}</strong>
                      </span>
                    </div>
                    <iframe
                      title={`${activePreview.label} preview`}
                      sandbox=""
                      srcDoc={emailPreviewDocument(previewBody)}
                    />
                  </div>
                  <p className="fixed-footer-note">
                    The signature and compliance footer are locked and will be
                    included in every sequence.
                  </p>
                </section>
              </div>
            </div>
          ) : (
            <div className="audience-stage">
              <section className="selected-template-summary">
                <span>
                  <small>Selected template</small>
                  <strong>{selectedTemplate?.name || "No template selected"}</strong>
                  <span>{selectedTemplate?.subject_template}</span>
                </span>
                <button type="button" className="text-button" onClick={() => setStage("template")}>
                  Change template
                </button>
              </section>
              <div className="campaign-details-grid">
                <label>
                  Internal campaign title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="August bookkeeping outreach"
                    required
                  />
                </label>
                <label>
                  Sending address
                  <input
                    type="email"
                    value={senderEmail}
                    onChange={(event) => setSenderEmail(event.target.value)}
                    placeholder="Uses local default when blank"
                  />
                </label>
                <label>
                  Initial send date and time
                  <input
                    type="datetime-local"
                    value={initialSendAt}
                    min={minimumLocalSendTime()}
                    onChange={(event) => setInitialSendAt(event.target.value)}
                    required
                  />
                </label>
              </div>
          <div className="recipient-picker">
            <div className="picker-heading">
              <div>
                <strong>Validated recipients</strong>
                    <span>
                      {selectedLeadIds.length} selected · {sentLeadIds.length} already sent
                    </span>
              </div>
                  <div className="picker-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setSelectedLeadIds(
                          Array.from(new Set([...selectedLeadIds, ...selectableLeadIds])),
                        )
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setSelectedLeadIds([])}
                    >
                      Uncheck all
                    </button>
                  </div>
            </div>
                <div className="recipient-filters">
                  <label>
                    Lead label
                    <select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
                      <option value="all">All labels</option>
                      {existingLabels.map((label) => (
                        <option value={label} key={label}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={hidePreviouslySent}
                      onChange={togglePreviouslySent}
                    />
                    Hide people already sent this template
                  </label>
                </div>
            <div className="recipient-list">
                  {visibleLeads.map((lead) => {
                    const alreadySent = sentSet.has(lead.id);
                    return (
                <label className={alreadySent ? "recipient-row already-used" : "recipient-row"} key={lead.id}>
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.includes(lead.id)}
                          disabled={alreadySent}
                    onChange={() =>
                      setSelectedLeadIds(
                        selectedLeadIds.includes(lead.id)
                          ? selectedLeadIds.filter((id) => id !== lead.id)
                          : [...selectedLeadIds, lead.id],
                      )
                    }
                  />
                  <span>
                    <strong>
                      {[lead.first_name, lead.last_name]
                        .filter(Boolean)
                        .join(" ") || lead.email}
                    </strong>
                    <small>{lead.email}</small>
                        <small>{lead.batch_label || "Unlabelled"}</small>
                  </span>
                      {alreadySent && <em>Already sent</em>}
                </label>
                    );
                  })}
                  {!visibleLeads.length && (
                <p className="empty-copy">
                      No unused validated recipients match this label.
                </p>
              )}
            </div>
          </div>
          <div className="composer-footer">
            <p>
                  Recipients who were already sent this template cannot be selected again.
            </p>
            <button
              className="primary-button"
                  disabled={saving || !selectedLeadIds.length || !selectedTemplateId}
            >
              {saving ? "Staging…" : "Stage campaign"}
            </button>
          </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function RichTextEditor({
  value,
  onChange,
  onFocus,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      editor &&
      document.activeElement !== editor &&
      editor.innerHTML !== value
    ) {
      editor.innerHTML = value;
    }
  }, [value]);

  function runCommand(command: string, commandValue?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, commandValue);
    onChange(editor.innerHTML);
  }

  function addLink() {
    const selection = window.getSelection();
    const savedRange = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : null;
    const input = window.prompt("Paste the link URL");
    if (!input?.trim()) return;
    const href = /^https?:\/\//i.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`;
    editorRef.current?.focus();
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    document.execCommand("createLink", false, href);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function insertPlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const safeHtml = text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/\r?\n/g, "<br>");
    runCommand("insertHTML", safeHtml);
  }

  const buttons = [
    { label: "Bold", text: "B", command: "bold", className: "bold" },
    { label: "Italic", text: "I", command: "italic", className: "italic" },
    {
      label: "Underline",
      text: "U",
      command: "underline",
      className: "underline",
    },
    {
      label: "Bulleted list",
      text: "• List",
      command: "insertUnorderedList",
      className: "",
    },
    {
      label: "Numbered list",
      text: "1. List",
      command: "insertOrderedList",
      className: "",
    },
  ];

  return (
    <div className="rich-text-editor">
      <div className="editor-toolbar" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        {buttons.map((button) => (
          <button
            type="button"
            className={button.className}
            aria-label={button.label}
            title={button.label}
            onMouseDown={(event) => {
              event.preventDefault();
              runCommand(button.command);
            }}
            key={button.command}
          >
            {button.text}
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          type="button"
          aria-label="Add link"
          title="Add link"
          onMouseDown={(event) => {
            event.preventDefault();
            addLink();
          }}
        >
          Link
        </button>
        <button
          type="button"
          aria-label="Clear formatting"
          title="Clear formatting"
          onMouseDown={(event) => {
            event.preventDefault();
            runCommand("removeFormat");
          }}
        >
          Clear
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-text-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        data-placeholder={placeholder}
        onFocus={onFocus}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onPaste={insertPlainText}
        onDrop={(event) => event.preventDefault()}
      />
    </div>
  );
}

function emailPreviewDocument(body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html { background: #ffffff; }
      body { margin: 0; padding: 24px; color: #202124; background: #ffffff; font-family: Arial, Helvetica, sans-serif; }
      p:first-child { margin-top: 0; }
      a { color: #356859; }
      img { max-width: 100%; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function Metric({
  label,
  value,
  detail,
  accent = false,
  suffix = "",
}: {
  label: string;
  value: number;
  detail: string;
  accent?: boolean;
  suffix?: string;
}) {
  return (
    <article className={accent ? "metric-card accent" : "metric-card"}>
      <span>{label}</span>
      <strong>
        {value}
        {suffix}
      </strong>
      <small>{detail}</small>
    </article>
  );
}

function parseResearchSpreadsheet(value: string): ImportPreviewRow[] {
  const delimiter = detectDelimiter(value);
  const grid = parseDelimited(value, delimiter).filter((row) =>
    row.some((cell) => cell.trim()),
  );
  const headerIndex = grid.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    const hasFullName = headers.some((header) =>
      ["contact name", "full name", "person name", "contact full name"].includes(
        header,
      ),
    );
    const hasSplitName =
      headers.some((header) => ["first name", "firstname"].includes(header)) &&
      headers.some((header) => ["last name", "lastname", "surname"].includes(header));
    return (
      (hasFullName || hasSplitName) &&
      (headers.includes("company name") ||
        headers.includes("business email") ||
        headers.includes("email") ||
        headers.includes("email address"))
    );
  });
  if (headerIndex < 0) {
    throw new Error(
      "Relay could not find a contact name (or First Name and Last Name) plus a Company or Email column.",
    );
  }
  const headers = grid[headerIndex].map(normalizeHeader);
  const get = (row: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? String(row[index] || "").trim() : "";
  };
  return grid
    .slice(headerIndex + 1)
    .map((row, index) => {
      const businessEmail = get(row, [
        "business email",
        "business email address",
        "email",
        "email address",
        "work email",
        "work email address",
        "contact email",
        "e mail",
      ]);
      const emailDomain = domainFromEmail(businessEmail);
      const companyWebsite =
        get(row, ["company website", "company url", "website", "website url", "domain"]) ||
        (emailDomain ? `https://${emailDomain}` : "");
      const contactName =
        get(row, ["contact name", "contact full name", "full name", "person name"]) ||
        [
          get(row, ["first name", "firstname"]),
          get(row, ["last name", "lastname", "surname"]),
        ]
          .filter(Boolean)
          .join(" ");
      const companyName =
        get(row, ["company name", "company"]) || emailDomain;
      return {
        selected: Boolean(companyName && companyWebsite && contactName),
        company_name: companyName,
        company_website: companyWebsite,
        company_linkedin:
          get(row, ["company linkedin", "linkedin company"]) || null,
        location: get(row, ["location"]) || null,
        industry_services:
          get(row, ["industry services", "industry", "services"]) || null,
        employee_size:
          get(row, ["employee size", "company size", "employees"]) || null,
        contact_name: contactName,
        job_title: get(row, ["job title", "role", "title"]) || null,
        contact_linkedin:
          get(row, ["contact linkedin", "linkedin", "profile url"]) || null,
        business_email: businessEmail || null,
        email_status:
          get(row, ["email status", "validation status"]) || "Missing",
        why_this_lead_fits:
          get(row, ["why this lead fits", "why lead fits", "fit"]) || null,
        lead_tier:
          get(row, ["lead score tier", "lead tier", "tier", "lead score"]) ||
          null,
        outreach_status:
          get(row, ["outreach status", "status"]) || "Research",
        last_contacted: get(row, ["last contacted"]) || null,
        next_step: get(row, ["next step"]) || null,
        next_step_date: get(row, ["next step date"]) || null,
        notes:
          get(row, ["reply lead notes", "lead notes", "notes"]) || null,
        assigned_to: get(row, ["assigned to", "owner"]) || null,
        source_row: headerIndex + index + 2,
      };
    })
    .filter(
      (row) =>
        row.company_name || row.company_website || row.contact_name,
    );
}

function detectDelimiter(value: string) {
  const lines = value.split(/\r?\n/).slice(0, 8);
  const tabs = lines.reduce(
    (total, line) => total + (line.match(/\t/g)?.length || 0),
    0,
  );
  const commas = lines.reduce(
    (total, line) => total + (line.match(/,/g)?.length || 0),
    0,
  );
  const semicolons = lines.reduce(
    (total, line) => total + (line.match(/;/g)?.length || 0),
    0,
  );
  if (tabs > commas && tabs > semicolons) return "\t";
  return semicolons > commas ? ";" : ",";
}

function parseDelimited(value: string, delimiter: string) {
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
    } else if (character === delimiter && !quoted) {
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

function domainFromEmail(value: string) {
  const email = value.trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "";
  const domain = email.slice(separator + 1);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : "";
}

function parseLeads(value: string) {
  const grid = parseDelimited(value, detectDelimiter(value)).filter((row) =>
    row.some((cell) => cell.trim()),
  );
  if (!grid.length) return [];
  const headers = grid[0].map(normalizeHeader);
  const emailHeaders = [
    "email",
    "email address",
    "business email",
    "business email address",
    "work email",
    "work email address",
    "contact email",
    "e mail",
  ];
  const emailIndex = headers.findIndex((header) =>
    emailHeaders.includes(header),
  );
  if (emailIndex >= 0) {
    const get = (row: string[], names: string[]) => {
      const index = headers.findIndex((header) => names.includes(header));
      return index >= 0 ? String(row[index] || "").trim() : "";
    };
    return grid
      .slice(1)
      .map((row) => {
        const fullName = get(row, [
          "contact name",
          "contact full name",
          "full name",
          "person name",
        ]);
        const name = splitImportedName(fullName);
        const email = String(row[emailIndex] || "").trim();
        return {
          email,
          first_name:
            get(row, ["first name", "firstname", "given name"]) || name.first,
          last_name:
            get(row, ["last name", "lastname", "surname", "family name"]) ||
            name.last,
          company:
            get(row, [
              "company",
              "company name",
              "organization",
              "organisation",
            ]) || domainFromEmail(email),
          validation_status: get(row, [
            "verification status",
            "validation status",
            "email status",
            "email verification status",
            "verified",
          ]),
        };
      })
      .filter((lead) => Boolean(lead.email));
  }
  const headerLooksLikeData = grid[0].some((cell) => cell.includes("@"));
  if (!headerLooksLikeData) {
    throw new Error(
      `Relay could not find an email column. Use one of these headers: ${emailHeaders.join(
        ", ",
      )}.`,
    );
  }
  return grid
    .map((row) => {
      const [email, first_name, last_name, company, validation_status] = row.map(
        (part) => part.trim(),
      );
      return { email, first_name, last_name, company, validation_status };
    })
    .filter((lead) => Boolean(lead.email));
}

function splitImportedName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function minimumLocalSendTime() {
  return toLocalDateTimeInput(new Date());
}

function defaultLocalSendTime() {
  const value = new Date(Date.now() + 15 * 60 * 1000);
  value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5, 0, 0);
  return toLocalDateTimeInput(value);
}

function toLocalDateTimeInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
