-- The Switchboard: core schema
-- Tables, enums and indexes. Business rules live in 20260925000002_functions.sql,
-- access rules in 20260925000003_rls.sql.
--
-- Conventions
--   * Every timestamp is timestamptz (stored UTC, shown in Australian time by the app).
--   * Dates with no time component (expiry dates, DOB) are plain `date`.
--   * Internal helpers live in the `private` schema, which is not exposed through the API.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'coordinator', 'clinical_lead', 'clinician');

create type public.family_status as enum (
  'new', 'contacted', 'intake_booked', 'intake_done', 'ready_to_match',
  'offered', 'accepted', 'intro_booked', 'intro_done', 'converted',
  'waitlist', 'lost', 'not_suitable', 'withdrawn'
);

create type public.funding_type as enum (
  'ndis_self_managed', 'ndis_plan_managed', 'ndis_agency_managed',
  'private', 'medicare', 'unsure'
);

create type public.service_type as enum ('speech', 'ot', 'unsure');

create type public.profession as enum ('speech_pathologist', 'occupational_therapist');

create type public.clinician_status as enum (
  'applied', 'screening', 'documents_requested', 'documents_verified',
  'agreement_signed', 'onboarding', 'orientation', 'active', 'paused', 'offboarded'
);

create type public.pause_reason as enum ('credentials', 'clinician_request', 'quality', 'payment');

create type public.credential_type as enum (
  'spa_cpsp',               -- Speech Pathology Australia Certified Practising (speech pathologists)
  'ahpra',                  -- AHPRA registration (OTs)
  'wwcc',                   -- Working with Children Check
  'ndis_worker_screening',  -- NDIS Worker Screening Check
  'ndis_orientation',       -- NDIS Worker Orientation Module
  'pi_insurance',           -- Professional indemnity insurance
  'pl_insurance',           -- Public liability insurance
  'abn',                    -- ABN (checked automatically against ABN Lookup)
  'medicare_provider',      -- optional
  'phi_provider',           -- optional: private health insurer provider numbers
  'ndis_registration',      -- optional
  'drivers_licence',        -- home visits: sighted only, never stored
  'car_insurance'           -- home visits: business use, sighted only
);

create type public.credential_status as enum ('pending', 'verified', 'rejected', 'expired', 'superseded');

-- proposed: on an approved/unapproved shortlist, not yet sent to the clinician
create type public.match_state as enum ('proposed', 'offered', 'accepted', 'declined', 'timeout', 'withdrawn');

create type public.intake_outcome as enum ('ready_to_match', 'not_suitable', 'needs_follow_up');

create type public.intro_outcome as enum ('going_ahead', 'not_going_ahead');

create type public.time_block as enum ('after_school', 'weekends', 'school_hours');

create type public.message_channel as enum ('email', 'sms', 'slack');

create type public.message_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

create type public.fee_statement_status as enum ('draft', 'confirmed', 'issued', 'collected', 'failed', 'void');

-- ---------------------------------------------------------------------------
-- Users and settings
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null,
  full_name    text not null,
  email        text not null,
  show_uk_time boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id)
);

insert into public.settings (key, value, description) values
  ('offer_mode',              '"sequential"', 'sequential = one clinician at a time; parallel = several at once, first to accept wins'),
  ('parallel_offer_count',    '3',            'How many clinicians get the offer at once in parallel mode'),
  ('offer_response_hours',    '48',           'How long a clinician has to accept or decline an offer'),
  ('offer_nudge_hours',       '24',           'Send an SMS nudge if an offer is still unanswered after this many hours'),
  ('stale_limits_hours',      '{"new": 24, "contacted": 48, "intake_booked": 168, "intake_done": 48, "ready_to_match": 48, "offered": 48, "accepted": 120, "intro_booked": 168, "intro_done": 168, "waitlist": 336}',
                                              'Flag a family on the dashboard when it sits in a status longer than this'),
  ('require_mfa',             'true',         'Require multi-factor login for every staff member and clinician'),
  ('credential_reminder_days','[60, 30, 7]',  'Days before expiry that clinicians are reminded'),
  ('staff_alert_days',        '7',            'Days before expiry that staff are alerted'),
  ('family_followup_days',    '14',           'Days after the first session to send the family satisfaction check'),
  ('clinician_checkin_days',  '42',           'Days after the first session to check in with the clinician'),
  ('recredential_months',     '12',           'How often clinicians are asked to re-confirm their profile, capacity and insurance'),
  ('abn_recheck_days',        '90',           'How often ABNs are re-checked against ABN Lookup'),
  ('retention_months',        '12',           'Months before families who do not go ahead are anonymised (confirm with privacy lawyer)'),
  ('service_fee_rate',        '0.20',         'Company service fee as a fraction of the fee base (ex GST)'),
  ('gst_rate',                '0.10',         'GST rate applied to the service fee'),
  ('staff_alert_email',       '"intake@example.com"', 'Where coordinator alerts are emailed'),
  ('consent_version',         '"2026-09"',    'Current version of the privacy collection notice and consent wording');

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

create table public.families (
  id                  uuid primary key default gen_random_uuid(),
  parent_name         text not null check (length(parent_name) between 1 and 200),
  email               text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobile              text not null check (mobile ~ '^\+61[2-478]\d{8}$'),  -- E.164, Australian
  suburb              text not null,
  postcode            text not null check (postcode ~ '^\d{4}$'),
  state               text check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT')),
  lat                 double precision check (lat between -45 and -9),
  lng                 double precision check (lng between 112 and 155),
  funding_type        public.funding_type not null,
  plan_manager        text,
  referral_source     text,
  status              public.family_status not null default 'new',
  status_reason       text,
  status_changed_at   timestamptz not null default now(),
  waitlist_reason     text,
  waitlist_codes      text[] not null default '{}',  -- machine-readable, feeds recruitment targeting
  assigned_to         uuid references public.profiles (id),
  complex_case        boolean not null default false,  -- complex cases need a clinical lead to approve the match
  anonymised_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index families_status_idx on public.families (status, status_changed_at);
create index families_email_idx on public.families (lower(email));

create table public.children (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families (id) on delete cascade,
  first_name          text not null check (length(first_name) between 1 and 100),
  dob                 date,
  age_years           smallint check (age_years between 0 and 25),  -- when the family gave age, not DOB
  concerns            text[] not null default '{}' check (
                        concerns <@ array['speech_sounds', 'language', 'stuttering', 'social_communication',
                                          'literacy', 'feeding', 'fine_motor', 'sensory', 'daily_living', 'other']
                      ),
  concern_other       text check (length(concern_other) <= 300),
  service_type        public.service_type not null,
  preferred_times     public.time_block[] not null default '{}',
  language            text,                    -- main language at home if not English
  gender_preference   text check (gender_preference in ('female', 'male')),
  telehealth_ok       boolean not null default false,
  interests_needed    text[] not null default '{}',  -- e.g. stuttering, autism, aac: used for scoring
  notes_intake        text check (length(notes_intake) <= 2000),  -- deliberately short: not clinical notes
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (dob is not null or age_years is not null)
);

create index children_family_idx on public.children (family_id);

create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families (id) on delete cascade,
  type         text not null check (type in ('privacy_collection', 'contact', 'share_with_clinician')),
  version      text not null,
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz
);

create index consents_family_idx on public.consents (family_id);

create table public.intake_calls (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references public.families (id) on delete cascade,
  coordinator_id     uuid references public.profiles (id),
  scheduled_at       timestamptz,
  calcom_booking_uid text unique,
  completed_at       timestamptz,
  outcome            public.intake_outcome,
  outcome_reason     text,
  answers            jsonb not null default '{}',  -- structured intake script answers
  notes              text check (length(notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index intake_calls_family_idx on public.intake_calls (family_id);

-- ---------------------------------------------------------------------------
-- Clinicians
-- ---------------------------------------------------------------------------

create table public.clinicians (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid unique references auth.users (id) on delete set null,
  name                       text not null,
  email                      text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobile                     text check (mobile ~ '^\+61[2-478]\d{8}$'),
  profession                 public.profession not null,
  experience_years           smallint check (experience_years between 0 and 70),
  gender                     text check (gender in ('female', 'male', 'non_binary', 'undisclosed')),
  interests                  text[] not null default '{}',
  age_groups                 text[] not null default '{}' check (age_groups <@ array['0-2', '3-5', '6-12', '13-17', '18+']),
  languages                  text[] not null default '{English}',
  suburb                     text,
  postcode                   text check (postcode ~ '^\d{4}$'),
  base_lat                   double precision check (base_lat between -45 and -9),
  base_lng                   double precision check (base_lng between 112 and 155),
  radius_km                  numeric(5, 1) check (radius_km between 0 and 300),
  service_postcodes          text[] not null default '{}',
  funding_types              public.funding_type[] not null default '{}',
  ndis_registered            boolean not null default false,
  home_visits                boolean not null default true,
  telehealth                 boolean not null default false,
  capacity_new               smallint not null default 0 check (capacity_new between 0 and 50),
  snoozed_until              date,
  status                     public.clinician_status not null default 'applied',
  pause_reason               public.pause_reason,
  status_changed_at          timestamptz not null default now(),
  abn                        text check (abn ~ '^\d{11}$'),
  calcom_intro_url           text check (calcom_intro_url ~ '^https://'),
  stripe_account_id          text,
  halaxy_ref                 text,
  clinical_lead_approved_by  uuid references public.profiles (id),
  clinical_lead_approved_at  timestamptz,
  application                jsonb not null default '{}',   -- answers from the Join the network form
  screening_notes            text check (length(screening_notes) <= 4000),
  last_recredentialed_at     timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check ((status = 'paused') = (pause_reason is not null))
);

create index clinicians_status_idx on public.clinicians (status);
create unique index clinicians_email_idx on public.clinicians (lower(email));

create table public.availability (
  id           uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 1 and 7),  -- ISO: 1 = Monday, 7 = Sunday
  start_time   time not null,
  end_time     time not null,
  check (end_time > start_time)
);

create index availability_clinician_idx on public.availability (clinician_id);

create table public.credentials (
  id                uuid primary key default gen_random_uuid(),
  clinician_id      uuid not null references public.clinicians (id) on delete cascade,
  type              public.credential_type not null,
  number            text,
  issuer            text,
  issued_at         date,
  expires_at        date,
  file_path         text,
  sighted_only      boolean not null default false,  -- ID-type documents: we record that we saw it, never a copy
  sighted_at        date,
  status            public.credential_status not null default 'pending',
  verified_by       uuid references public.profiles (id),
  verified_at       timestamptz,
  rejection_reason  text,
  notes             text,
  last_checked_at   timestamptz,
  uploaded_by       uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- keep only what's needed: no copies of licences or car insurance
  check (type not in ('drivers_licence', 'car_insurance') or (file_path is null and sighted_only)),
  check (not sighted_only or file_path is null),
  check (status <> 'verified' or verified_at is not null)
);

create index credentials_clinician_idx on public.credentials (clinician_id, type);
create index credentials_expiry_idx on public.credentials (expires_at) where status = 'verified';
create index credentials_pending_idx on public.credentials (created_at) where status = 'pending';

create table public.credential_reminders (
  credential_id uuid not null references public.credentials (id) on delete cascade,
  days_before   smallint not null,
  sent_at       timestamptz not null default now(),
  primary key (credential_id, days_before)
);

create table public.agreements (
  id            uuid primary key default gen_random_uuid(),
  clinician_id  uuid not null references public.clinicians (id) on delete cascade,
  version       text not null,
  sent_at       timestamptz,
  signed_at     timestamptz,
  documenso_ref text unique,
  file_path     text,
  created_at    timestamptz not null default now()
);

create index agreements_clinician_idx on public.agreements (clinician_id);

create table public.offboarding_checklists (
  clinician_id              uuid primary key references public.clinicians (id) on delete cascade,
  notice_received_at        date,
  families_handed_over      boolean not null default false,
  records_retention_confirmed boolean not null default false,
  access_removed            boolean not null default false,
  final_statement_issued    boolean not null default false,
  direct_debit_cancelled    boolean not null default false,
  notes                     text,
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Matching, referral offers and conversion
-- ---------------------------------------------------------------------------

create table public.matches (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families (id) on delete cascade,
  child_id          uuid not null references public.children (id) on delete cascade,
  clinician_id      uuid not null references public.clinicians (id) on delete cascade,
  state             public.match_state not null default 'proposed',
  rank              smallint not null default 1,
  rule_score        numeric(5, 1),
  score_breakdown   jsonb not null default '{}',
  distance_km       numeric(6, 1),
  ai_rank           smallint,
  ai_reason         text,
  proposed_by       uuid references public.profiles (id),
  proposed_at       timestamptz not null default now(),
  approved_by       uuid references public.profiles (id),
  approved_at       timestamptz,
  offered_at        timestamptz,
  offer_expires_at  timestamptz,
  nudged_at         timestamptz,
  responded_at      timestamptz,
  response_reason   text check (length(response_reason) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index matches_child_idx on public.matches (child_id, state, rank);
create index matches_clinician_idx on public.matches (clinician_id, state);
create index matches_offer_expiry_idx on public.matches (offer_expires_at) where state = 'offered';
create unique index matches_live_unique on public.matches (child_id, clinician_id)
  where state in ('proposed', 'offered', 'accepted');
-- only one clinician can hold a child at a time
create unique index matches_one_accepted on public.matches (child_id) where state = 'accepted';

create table public.intro_calls (
  id                 uuid primary key default gen_random_uuid(),
  match_id           uuid not null references public.matches (id) on delete cascade,
  scheduled_at       timestamptz,
  calcom_booking_uid text unique,
  outcome            public.intro_outcome,
  reason             text check (length(reason) <= 500),
  recorded_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index intro_calls_match_idx on public.intro_calls (match_id);

create table public.conversions (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null unique references public.matches (id) on delete cascade,
  first_session_at  date not null,
  confirmed_at      timestamptz not null default now(),
  confirmed_by      uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Service fees (v1.1: table is here so statements can be drafted early)
-- ---------------------------------------------------------------------------

create table public.fee_statements (
  id              uuid primary key default gen_random_uuid(),
  clinician_id    uuid not null references public.clinicians (id) on delete restrict,
  period          date not null check (extract(day from period) = 1),  -- first day of the month
  sessions        integer not null default 0 check (sessions >= 0),
  gross_received  numeric(12, 2) not null default 0,
  fee_ex_gst      numeric(12, 2) not null default 0,
  gst             numeric(12, 2) not null default 0,
  fee_inc_gst     numeric(12, 2) not null default 0,
  status          public.fee_statement_status not null default 'draft',
  debit_ref       text,
  pdf_path        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinician_id, period),
  check (fee_inc_gst = fee_ex_gst + gst)
);

-- ---------------------------------------------------------------------------
-- History, audit and messaging
-- ---------------------------------------------------------------------------

create table public.status_history (
  id           bigint generated always as identity primary key,
  entity_type  text not null check (entity_type in ('family', 'clinician')),
  entity_id    uuid not null,
  from_status  text,
  to_status    text not null,
  reason       text,
  by           uuid references auth.users (id),
  at           timestamptz not null default now()
);

create index status_history_entity_idx on public.status_history (entity_type, entity_id, at);
create index status_history_to_idx on public.status_history (entity_type, to_status, at);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  action       text not null,   -- insert / update / delete / view / export / download
  entity_type  text not null,
  entity_id    uuid,
  detail       jsonb,
  at           timestamptz not null default now(),
  ip           text
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, at);
create index audit_log_user_idx on public.audit_log (user_id, at);

create table public.message_templates (
  key          text not null,
  channel      public.message_channel not null,
  subject      text,
  body         text not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id),
  primary key (key, channel)
);

-- Outbox + log in one: rows are queued by database functions and sent by the app.
-- Forms and state changes never depend on an email or SMS provider being up.
create table public.message_log (
  id              uuid primary key default gen_random_uuid(),
  template        text not null,
  channel         public.message_channel not null,
  recipient       text not null,
  recipient_kind  text not null check (recipient_kind in ('family', 'clinician', 'staff')),
  recipient_id    uuid,
  payload         jsonb not null default '{}',
  status          public.message_status not null default 'queued',
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  attempts        smallint not null default 0,
  last_error      text,
  provider_ref    text,
  created_at      timestamptz not null default now()
);

create index message_log_queue_idx on public.message_log (scheduled_for) where status = 'queued';
create index message_log_recipient_idx on public.message_log (recipient_kind, recipient_id, created_at);

-- Single-use links in emails (e.g. "first session booked?" one-click answer).
create table public.action_tokens (
  token_hash  text primary key,
  purpose     text not null check (purpose in ('first_session')),
  match_id    uuid references public.matches (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);
