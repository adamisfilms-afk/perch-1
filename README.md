# The Switchboard

The company's internal operating system. It takes a family from first enquiry to a first booked session with an independent speech pathologist or OT, and a clinician from application to off-boarding. Clinical notes, invoicing and NDIS/Medicare claiming stay in each clinician's Halaxy.

Built from the product spec v0.1 (23 Sep 2026). This is the **MVP** scope (spec §14) plus the database groundwork for v1.1.

## What's here

| Area | What it does |
|---|---|
| **Public forms** | Enquiry form (`/enquire`) and "Join the network" (`/join`), with server-side validation, Australian mobile checking, Turnstile, rate limiting and versioned consent. Submissions are saved even if email, SMS or the map service is down. |
| **Client summary** | Redesigned workspace (`/clients`): KPI band (total, active share, sign-up to first session, new sign-ups) against targets, a sortable and searchable client table with time in the current step flagged against its target, a client details modal, and a settings modal (⋯) where admins set the step and KPI targets. |
| **Family pipeline** | Board by status with stale highlighting (`/families`), family page with the structured intake script, status changes with reasons, timeline, messages and consent record. |
| **Matching** | Rule-based hard filters and weighted score (spec C1–C2). Shows who passes, why others were ruled out, and a waitlist reason with codes for recruitment. A person saves the shortlist and a person approves it; complex cases need a clinical lead. |
| **Referral offers** | One clinician at a time (or N in parallel, first to accept wins: a setting). 48h window, 24h SMS nudge, automatic move to the next clinician on decline or timeout. Clinicians see a de-identified summary until they accept. |
| **Conversion** | Intro-call outcome, one-click "first session booked?" email link, automatic 2-week family and 6-week clinician follow-ups. |
| **Clinician lifecycle** | Recruitment statuses, go-live checklist and gate, credential tracking and verification queue, "sighted only" for licence and car insurance, ABN Lookup, Documenso agreement, portal invites, off-boarding checklist. |
| **Credential automation** | Daily job: 60/30/7-day reminders, staff alert at 7 days, automatic **Paused (credentials)** on expiry (open offers withdrawn), automatic reactivation once a new document is verified, yearly re-credentialing prompt. |
| **Clinician portal** | Mobile-first: referrals to accept or decline, my families, profile, capacity, snooze, availability, document uploads. |
| **Dashboard & metrics** | Operations dashboard (funnel, stale families, open offers, waitlist reasons, expiring credentials, paused clinicians) and the §7 key metrics with breakdowns. |
| **Admin** | Settings (offer mode, windows, stale limits, reminder days, MFA…), editable message templates, staff invites and access removal, manual job runs, failed-message log. |

## How it's built

- **Next.js 16** (App Router, Server Actions) on **Vercel (Sydney)**; Tailwind.
- **Supabase** (Postgres, Auth, Storage, pg_cron) in **Sydney**.
- The business rules live **in the database** (`supabase/migrations/`), so they hold whichever part of the system makes a change:
  - status machines for families and clinicians, with a history row for every change (who, when, why);
  - the **go-live gate** (no Active without verified, in-date documents, a signed agreement and clinical-lead approval);
  - offers, timeouts and the next-on-shortlist logic;
  - credential expiry, reminders and auto-pause/reactivation;
  - an **outbox** (`message_log`): database functions queue emails/SMS/Slack, the app sends them (`/api/cron/tick`, and straight after each action), retrying with backoff. Nothing is lost if a provider is down.
- **Row-level security on every table.** Every role check also requires multi-factor login (`aal2`), so a stolen password alone can't read family data, even through the API. The public role has no table access at all. Clinicians see a family only after accepting it.
- **Audit log** of every change to family, clinician and credential data (column names only, never values), plus explicit view/download logging.
- Documents live in a **private bucket**, uploaded straight from the browser with one-time signed upload URLs and opened only through 60-second signed links.

```
src/app/(public)     enquiry and join forms, privacy notice
src/app/(auth)       login, MFA set-up/verify, password
src/app/(workspace)  the redesigned workspace (sidebar layout): clients
src/app/(staff)      dashboard, families, waitlist, clinicians, verification, metrics, settings
src/app/(portal)     clinician portal
src/app/api          Cal.com + Documenso webhooks, cron, signed file access
src/lib/matching.ts  matching engine (pure, unit tested)
supabase/migrations  schema, business rules, RLS, pg_cron, message templates
tests/db             database tests on real Postgres (RLS, gate, offers, expiry…)
```

## Running it locally

You need Node 22 and Docker (for the Supabase CLI).

```bash
npm install
npx supabase start                 # Postgres, Auth, Storage, Studio (uses supabase/config.toml)
npx supabase db reset              # applies supabase/migrations
cp .env.example .env.local         # fill in the URL and keys printed by `supabase start`
echo "TURNSTILE_DISABLED=true" >> .env.local
npm run seed:demo                  # demo staff, clinicians and families
npm run dev
```

Log in at http://localhost:3000/login with `admin@switchboard.test`, `coordinator@switchboard.test`, `lead@switchboard.test` or a clinician (`priya@switchboard.test`, `tom@…`, `grace@…`, `mia@…`, `sam@…`), password `switchboard-demo-2026`. You'll be asked to set up an authenticator app on first login.

Without email/SMS keys, messages are marked **skipped** in the message log instead of sent. Without a Mapbox token, families aren't placed on the map and are flagged on the dashboard.

## Tests

```bash
npm test                                                     # unit tests: matching, validation, time zones, ABN, templates, webhooks
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
npm run lint && npm run typecheck && npm run build
```

The database tests build a throwaway database, apply every migration and act as anon, staff, clinicians and the service role exactly as PostgREST does. They cover: no public access, MFA enforcement, de-identified offers, clinician self-edit limits, the go-live gate, sequential and parallel offers, timeouts and nudges, complex-case approval, the first-session link, credential expiry → pause → reactivation, reminder bands, ABN deactivation, waitlist alerts and the outbox. CI runs all of this on every pull request.

## Deploying

1. **Supabase**: create a project in **Sydney (ap-southeast-2)**. Enable point-in-time recovery. Link it and run `npx supabase db push`. Turn on pg_cron (the migration schedules the daily and offer jobs).
2. **Auth settings**: disable self sign-up; enable TOTP MFA; set the Site URL; set up custom SMTP; change the **Invite** and **Reset password** email templates to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery`).
3. **Vercel**: import the repo, region `syd1` (set in `vercel.json`), add the variables from `.env.example`. `vercel.json` schedules `/api/cron/daily` each morning (daily is all Vercel's Hobby plan allows). Supabase calls `/api/cron/tick` every 5 minutes: in the Supabase dashboard (Integrations → Vault) add `switchboard_app_url` (your site address) and `switchboard_cron_secret` (the same value as `CRON_SECRET`).
4. **Cal.com**: add a webhook to the intake, screening and each clinician's intro event type pointing at `/api/webhooks/calcom`, with the shared secret. Booking links the app sends carry `metadata[family_id]` / `metadata[match_id]` so bookings match up; email is the fallback.
5. **Documenso**: create the agreement template with one recipient; set the webhook (`DOCUMENT_COMPLETED`) to `/api/webhooks/documenso` with the secret.
6. **First admin**: invite yourself from the Supabase dashboard, then insert your `profiles` row with role `admin`. Invite everyone else from **Settings**.

## Decisions on the open questions (spec §15)

All of these are settings or easy to change, so they can be revisited without code changes where noted.

1. **One at a time or parallel?** Sequential by default. Parallel (first to accept wins, N at once) is the `offer_mode` / `parallel_offer_count` setting.
2. **Response window and timeout?** 48 hours (`offer_response_hours`), SMS nudge at 24 (`offer_nudge_hours`). On timeout the next approved clinician is offered; when the shortlist runs out the family returns to Ready to match and coordinators are alerted.
3. **Session numbers before Halaxy?** v1.1. The `fee_statements` table and fee maths (`src/lib/fees.ts`) are in place; capture is not built yet.
4. **What the offer summary shows:** child's age, suburb, approximate distance, concerns, service, funding, preferred times, home language, telehealth. Never names, contact details, street address or postcode.
5. **Retention:** `retention_months` defaults to 12 and `anonymise_stale_families()` exists, but it is **not scheduled** until the privacy lawyer confirms the period. Once agreed, schedule `select public.run_scheduled_jobs('retention')` (or run it by hand).
6. **AI provider:** not in the MVP (v2). `matches.ai_rank` / `ai_reason` are ready for it.
7. **Family logins:** not in v1; families use email, SMS and links.
8. **Speech and OT from day one?** Yes, one interface; profession and service type drive matching and the required credentials (SPA CPSP vs AHPRA).

## Not built yet, and things to know

- **v1.1:** fee statements, tax invoices, direct debit, Stripe reconciliation, recording satisfaction replies. **v2:** AI ranking, Halaxy API, family portal.
- **Sentry** isn't wired in yet. Add it with PII scrubbing before launch.
- Stale limits are in hours (not business hours). Business-day targets are used on the metrics page.
- Staff can override any family status as **admin**; every override is still recorded in the history and audit log.
- The ABN and NDIS-registration flags are set by verification, never by clinicians themselves.

**Before real family data goes in** (spec §14): independent penetration test, privacy policy reviewed by a lawyer, breach response plan, data-processing terms with every vendor, confirm the retention schedule, and check MFA is enforced (`require_mfa` = true, the default).
