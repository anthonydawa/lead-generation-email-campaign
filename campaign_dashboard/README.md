# Relay Lead Intelligence & Campaign Workspace

Relay is a private lead-intelligence and email-campaign workspace. It saves
source-attributed professional prospects in Supabase while keeping sendable email
contacts separate. Gmail sending and reply polling remain on the local Python
worker.

## Product flow

1. Find companies in Relay or export the existing Google Sheets Lead Tracker
   tab as CSV and upload it under Saved leads.
2. Review the detected columns and save selected research leads to Supabase.
   Only imported emails marked exactly `Verified` become campaign-ready
   immediately. Every other status stays out of campaign contacts and enters
   the full Find Email workflow, where the spreadsheet email is treated as a
   candidate alongside public evidence and provider results.
3. Use the imported lead's `Find email` action. Relay checks public
   company-controlled evidence, tries configured finder APIs sequentially, and
   verifies likely company-domain candidates.
4. Approve only a deliverable personal address to add it to the email-ready
   contacts list.
5. Select valid pending recipients and stage a campaign in Relay.
6. Keep `python main.py worker` running locally. It sends initial messages at
   their scheduled time, polls for replies, and sends due same-thread
   follow-ups.

Relay does not scrape LinkedIn and does not represent the standard LinkedIn API
as an unrestricted people-search product. Without an approved endpoint, the UI
runs in clearly marked demo mode.

The main lead finder can query Tavily, Serper, Brave Search, SerpApi, and Exa
sequentially, moving to the next provider only when the current source is
exhausted, fails, or cannot fill the requested number of unique companies. It
then runs Relay's own lightweight website checker. A query such as `digital marketing agencies` in
`United States` returns likely official websites, verifies that each website
responds, respects `robots.txt`, and extracts public emails, phone numbers,
descriptions, and LinkedIn company links from the homepage and one permitted
contact/about page. Hunter is an optional follow-up source for domains where the
website did not publish an email.

Each live company card also has a controlled research action. Relay checks up
to six permitted public pages on the selected company domain, extracts
source-backed facts, and sends only cleaned page text to one configured AI
provider. Gemini, Groq, Cohere, OpenRouter, and Cloudflare Workers AI are tried
sequentially; a later provider is used only when the earlier provider is
exhausted or fails. AI output is treated as analysis, while people and roles
must still be supported by a checked source page.

Confirmed people in the research panel have a `Find email` action. Relay first
checks likely company team, leadership, about, and person pages while respecting
`robots.txt`. It detects exact public person emails, learns useful formatting
signals from public same-domain addresses, checks MX records, and then tries
configured free email-finder APIs sequentially. If no finder returns an
address, it creates a small, ranked set of company-domain candidates and
validates them one at a time.
Hunter, ZeroBounce, Mailboxlayer, Verifalia, and Bouncer are supported; later
providers are used only when an earlier provider is unavailable, exhausted, or
returns an unknown result. Catch-all, disposable, role-based, and unverified
addresses cannot be approved as campaign contacts.

Provider calls are recorded in `lead_provider_usage`. Relay checks a local
per-provider ceiling before every request, displays usage in the search UI, and
skips a provider after its configured allowance is reached. These are safety
ceilings rather than a substitute for checking the provider dashboard.
Email finding checks exact public evidence before using a finder credit, reuses
confirmed company address patterns, caches MX checks for seven days, and caches
verification results for one to thirty days depending on the result. Finder and
verification operations are tracked separately while shared provider allowances
such as Hunter's are still enforced as one pool.

## Required Supabase setup

Run `gmail_campaign_engine_legacy/supabase_campaign_assignments.sql` once in the
Supabase SQL Editor. It adds campaign-specific recipient assignments and
backfills the completed test campaign.

Then run `gmail_campaign_engine_legacy/supabase_followup_sequences.sql` once. This
adds campaign dates, follow-up steps, per-recipient due dates, and Gmail thread
metadata.

Run `campaign_dashboard/supabase_linkedin_prospects.sql` once. This adds the
source-attributed prospect library and API usage log used by the lead finder.

Run or rerun `campaign_dashboard/supabase_web_leads.sql`. It adds saved search,
web-prospect, company research, email candidate, spreadsheet import batch, and
imported prospect tables, plus the domain-intelligence and email-verification
caches. The script is safe to rerun after a feature update.

Run `campaign_dashboard/supabase_relay_templates_and_labels.sql` once. It adds
reusable message templates, campaign-to-template tracking, and persistent lead
batch labels. The local sender contract is unchanged.

Run `campaign_dashboard/supabase_campaign_reporting.sql` once. It adds the
service-role-only daily worker reports used by Campaign stats. Active Gmail and
Lark workers refresh their health and campaign tally every 15 minutes without
interrupting delivery.

The server runtime requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DASHBOARD_PASSWORD`
- `DASHBOARD_USERNAME` (optional, defaults to `admin`)

Live lead search additionally requires:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`
- `LINKEDIN_APPROVED_SEARCH_ENDPOINT`
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_DAILY_LIMIT` (set this to the endpoint limit shown in the LinkedIn
  Developer Portal)
- `LINKEDIN_API_VERSION` (optional; review whenever LinkedIn sunsets a version)
- `TAVILY_API_KEY` (required for live web company discovery)
- `SERPER_API_KEY`
- `BRAVE_SEARCH_API_KEY`
- `SERPAPI_API_KEY`
- `EXA_API_KEY`
- `HUNTER_API_KEY`

Company research can use any one or more of:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `COHERE_API_KEY`
- `OPENROUTER_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN`

Contact finding and verification can use any one or more of:

- `HUNTER_API_KEY`
- `ZEROBOUNCE_API_KEY`
- `MAILBOXLAYER_API_KEY`
- `VERIFALIA_USERNAME` and `VERIFALIA_PASSWORD`
- `BOUNCER_API_KEY`

Relay performs syntax, same-domain, public-source, and DNS/MX checks without a
paid service. A verifier key is required before an inferred address can be
approved as campaign-ready. Provider ceilings are defined in `.env.example`
and should be set no higher than the allowance in each provider dashboard.

The corresponding model and local quota settings are documented in
`.env.example`. Limits should be adjusted to match the provider dashboard,
especially Gemini, whose free limits vary by model and project.

At least one search-provider key is required. Each provider also has a
configurable local ceiling in `.env.example`. Set those ceilings at or below
the allowance shown in the corresponding provider account.

The approved endpoint must return normalized JSON in the form
`{ "results": Prospect[] }`. The server adapter deliberately does not guess at
or call an unapproved member-search endpoint.

The OpenID Connect flow uses `/api/linkedin/connect`,
`/api/linkedin/callback`, and `/api/linkedin/status`. Each browser receives an
encrypted, HTTP-only connection cookie. The browser-visible status endpoint
returns only the member profile and token expiry; it never returns the access
token. OpenID Connect identifies the signed-in member and does not grant
prospect-search access.

Never expose the service-role key to browser code. Relay uses it only inside
server API routes. The built-in access gate blocks all dashboard and API routes
until `DASHBOARD_PASSWORD` is configured.

## Development

```bash
npm install
npm run dev
npm run build
```

The project uses standard Next.js scripts for local development and Vercel.
