-- Activity log: an append-only record of every important event for a family or a clinician, kept as evidence.
--
-- Written by triggers on the tables where things happen, so nothing depends on the app remembering to log:
-- status changes, sign-ups and enquiries, consents, applications, bookings (booked, moved, cancelled),
-- document uploads and checks, the agreement, referrals (offered, accepted, declined, expired, withdrawn),
-- intro calls, first sessions, profile, hours and notes changes, sign-ins and link resets.
-- Emails and texts sent are already kept in message_log and are shown alongside in the app.
--
-- Rows can't be changed or deleted, by anyone. They record who acted: a staff member (by id), the clinician,
-- the family, or the system. Service-role calls from clinician and family pages say who they act for in an
-- x-perch-actor request header (the app sets it; see src/lib/supabase/admin.ts). Family summaries avoid the
-- family's personal details, so they stay meaningful after anonymisation.

create table public.activity_log (
  id          bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('family', 'clinician')),
  entity_id   uuid not null,
  at          timestamptz not null default now(),
  kind        text not null,
  summary     text not null,
  detail      jsonb not null default '{}',
  actor_kind  text not null check (actor_kind in ('staff', 'clinician', 'family', 'system')),
  actor_id    uuid
);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id, at desc);

alter table public.activity_log enable row level security;
create policy activity_log_staff on public.activity_log for select to authenticated using ((select private.is_staff()));
revoke insert, update, delete, truncate on public.activity_log from anon, authenticated, service_role;

create or replace function private.activity_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The activity log can''t be changed' using errcode = '42501';
end $$;
create trigger activity_log_no_update before update or delete on public.activity_log
  for each row execute function private.activity_log_immutable();
create trigger activity_log_no_truncate before truncate on public.activity_log
  for each statement execute function private.activity_log_immutable();

-- "Fri 3 Oct 2026, 2:00 pm" in Sydney time.
create or replace function private.fmt_time(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Australia/Sydney', 'Dy FMDD Mon YYYY, FMHH12:MI am')
$$;

create or replace function private.log_event(p_entity_type text, p_entity_id uuid, p_kind text, p_summary text,
  p_detail jsonb default '{}', p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_actor text;
begin
  if p_entity_id is null then
    return;
  end if;
  if v_uid is not null then
    select role::text into v_role from public.profiles where id = v_uid;
    v_actor := case when v_role = 'clinician' then 'clinician' else 'staff' end;
  else
    v_actor := nullif(current_setting('app.actor', true), '');
    if v_actor is null then
      begin
        v_actor := nullif(current_setting('request.headers', true), '')::json ->> 'x-perch-actor';
      exception when others then
        v_actor := null;
      end;
    end if;
    if v_actor is null or v_actor not in ('clinician', 'family') then
      v_actor := 'system';
    end if;
  end if;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  values (p_entity_type, p_entity_id, coalesce(p_at, now()), p_kind, p_summary, coalesce(p_detail, '{}'),
          v_actor, case when v_actor = 'staff' then v_uid end);
end $$;

-- Columns that changed between two versions of a row, leaving out bookkeeping ones.
create or replace function private.changed_columns(p_old jsonb, p_new jsonb, p_skip text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(n.key order by n.key), '{}')
    from jsonb_each(p_new) n
   where n.value is distinct from p_old -> n.key and not (n.key = any (p_skip))
$$;

-- ---------------------------------------------------------------------------
-- Status changes (every one, with its reason)
-- ---------------------------------------------------------------------------

create or replace function private.log_status_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event(new.entity_type, new.entity_id, 'status',
    'Status: ' || coalesce(new.from_status || ' → ', '') || new.to_status || coalesce(' (' || nullif(new.reason, '') || ')', ''),
    jsonb_build_object('from', new.from_status, 'to', new.to_status, 'reason', nullif(new.reason, '')), new.at);
  return null;
end $$;
create trigger status_history_activity after insert on public.status_history
  for each row execute function private.log_status_history();

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

create or replace function private.log_family_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cols text[];
begin
  if tg_op = 'INSERT' then
    perform private.log_event('family', new.id, 'enquiry', 'Enquiry submitted',
      jsonb_build_object('funding_type', new.funding_type, 'suburb', new.suburb), new.created_at);
    return null;
  end if;
  if new.anonymised_at is not null and old.anonymised_at is null then
    perform private.log_event('family', new.id, 'anonymised', 'Personal details removed (retention)');
    return null;
  end if;
  v_cols := private.changed_columns(to_jsonb(old), to_jsonb(new),
    array['status', 'status_reason', 'status_changed_at', 'updated_at', 'created_at', 'lat', 'lng']);
  if cardinality(v_cols) > 0 then
    perform private.log_event('family', new.id, 'details_updated',
      'Details updated: ' || replace(array_to_string(v_cols, ', '), '_', ' '), jsonb_build_object('fields', v_cols));
  end if;
  return null;
end $$;
create trigger families_activity after insert or update on public.families
  for each row execute function private.log_family_change();

create or replace function private.log_child_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cols text[];
begin
  if tg_op = 'INSERT' then
    -- the child added with the enquiry is part of "Enquiry submitted"
    if exists (select 1 from public.children where family_id = new.family_id and id <> new.id) then
      perform private.log_event('family', new.family_id, 'details_updated', 'Another child added', jsonb_build_object('child_id', new.id));
    end if;
    return null;
  end if;
  v_cols := private.changed_columns(to_jsonb(old), to_jsonb(new), array['updated_at', 'created_at']);
  if cardinality(v_cols) > 0 then
    perform private.log_event('family', new.family_id, 'details_updated',
      'Child''s details updated: ' || replace(array_to_string(v_cols, ', '), '_', ' '),
      jsonb_build_object('child_id', new.id, 'fields', v_cols));
  end if;
  return null;
end $$;
create trigger children_activity after insert or update on public.children
  for each row execute function private.log_child_change();

create or replace function private.log_consent_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_event('family', new.family_id, 'consent',
      'Consent given: ' || replace(new.type, '_', ' ') || ' (version ' || new.version || ')',
      jsonb_build_object('type', new.type, 'version', new.version), new.granted_at);
  elsif new.withdrawn_at is not null and old.withdrawn_at is null then
    perform private.log_event('family', new.family_id, 'consent',
      'Consent withdrawn: ' || replace(new.type, '_', ' '), jsonb_build_object('type', new.type, 'version', new.version));
  end if;
  return null;
end $$;
create trigger consents_activity after insert or update on public.consents
  for each row execute function private.log_consent_change();

-- The sign-up (intake) call being recorded. Its booking is logged from appointments.
create or replace function private.log_intake_call() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    perform private.log_event('family', new.family_id, 'signup_call_recorded',
      'Sign-up call recorded' || coalesce(': ' || replace(new.outcome::text, '_', ' '), '') || coalesce(' (' || nullif(new.outcome_reason, '') || ')', ''),
      jsonb_build_object('outcome', new.outcome, 'reason', new.outcome_reason), new.completed_at);
  end if;
  return null;
end $$;
create trigger intake_calls_activity after insert or update on public.intake_calls
  for each row execute function private.log_intake_call();

-- ---------------------------------------------------------------------------
-- Clinicians
-- ---------------------------------------------------------------------------

create or replace function private.log_clinician_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cols text[];
begin
  if tg_op = 'INSERT' then
    perform private.log_event('clinician', new.id, 'signed_up', 'Signed up to join the network',
      jsonb_build_object('profession', new.profession), new.created_at);
    return null;
  end if;
  if new.application_submitted_at is not null and old.application_submitted_at is null then
    perform private.log_event('clinician', new.id, 'application_submitted', 'Application submitted (service agreement accepted)');
  end if;
  if new.intake_completed_at is not null and old.intake_completed_at is null then
    perform private.log_event('clinician', new.id, 'intake_call_recorded', 'Intake call recorded: approved and ready for clients');
  end if;
  if new.clinical_lead_approved_at is not null and old.clinical_lead_approved_at is null then
    perform private.log_event('clinician', new.id, 'approved', 'Approved by a clinical lead');
  end if;
  if new.screening_notes is distinct from old.screening_notes then
    perform private.log_event('clinician', new.id, 'notes_updated', 'Intake call notes updated');
  end if;
  if new.last_recredentialed_at is distinct from old.last_recredentialed_at and new.last_recredentialed_at is not null then
    perform private.log_event('clinician', new.id, 'yearly_check', 'Confirmed their details are up to date (yearly check-in)');
  end if;
  if new.link_version > old.link_version then
    perform private.log_event('clinician', new.id, 'link_reset', 'Signed out everywhere and old links cancelled');
  end if;
  if new.ndis_registered is distinct from old.ndis_registered then
    perform private.log_event('clinician', new.id, 'registration',
      case when new.ndis_registered then 'NDIS registration verified' else 'NDIS registration no longer recorded' end,
      jsonb_build_object('ndis_registered', new.ndis_registered));
  end if;
  v_cols := private.changed_columns(to_jsonb(old), to_jsonb(new), array[
    'status', 'status_changed_at', 'pause_reason', 'updated_at', 'created_at', 'application', 'application_submitted_at',
    'intake_completed_at', 'clinical_lead_approved_at', 'clinical_lead_approved_by', 'screening_notes',
    'last_recredentialed_at', 'link_version', 'ndis_registered', 'user_id', 'base_lat', 'base_lng']);
  if cardinality(v_cols) > 0 then
    perform private.log_event('clinician', new.id, 'profile_updated',
      'Profile updated: ' || replace(array_to_string(v_cols, ', '), '_', ' '), jsonb_build_object('fields', v_cols));
  end if;
  return null;
end $$;
create trigger clinicians_activity after insert or update on public.clinicians
  for each row execute function private.log_clinician_change();

create or replace function private.log_credential_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := replace(new.type::text, '_', ' ');
  v_detail jsonb := jsonb_build_object('credential_id', new.id, 'type', new.type, 'expires_at', new.expires_at);
begin
  if tg_op = 'INSERT' then
    if new.sighted_only then
      perform private.log_event('clinician', new.clinician_id, 'document_sighted', v_label || ' sighted by the team', v_detail);
    else
      perform private.log_event('clinician', new.clinician_id, 'document_uploaded', v_label || ' uploaded',
        v_detail || jsonb_build_object('has_file', new.file_path is not null));
    end if;
    if new.status = 'verified' then
      perform private.log_event('clinician', new.clinician_id, 'document_verified', v_label || ' verified', v_detail);
    end if;
    return null;
  end if;
  if new.status is distinct from old.status and new.status <> 'superseded' then
    perform private.log_event('clinician', new.clinician_id, 'document_' || new.status::text,
      v_label || ' ' || new.status::text || coalesce(' (' || nullif(new.rejection_reason, '') || ')', ''),
      v_detail || jsonb_build_object('reason', new.rejection_reason));
  end if;
  return null;
end $$;
create trigger credentials_activity after insert or update on public.credentials
  for each row execute function private.log_credential_change();

create or replace function private.log_agreement_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.signed_at is not null and (tg_op = 'INSERT' or old.signed_at is null) then
    perform private.log_event('clinician', new.clinician_id, 'agreement_signed',
      'Service agreement signed (version ' || new.version || ')' || case when new.documenso_ref is not null then ' via Documenso' else '' end,
      jsonb_build_object('version', new.version), new.signed_at);
  elsif tg_op = 'INSERT' and new.sent_at is not null then
    perform private.log_event('clinician', new.clinician_id, 'agreement_sent', 'Service agreement sent for signature (version ' || new.version || ')',
      jsonb_build_object('version', new.version));
  end if;
  return null;
end $$;
create trigger agreements_activity after insert or update on public.agreements
  for each row execute function private.log_agreement_change();

create or replace function private.log_clinician_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event('clinician', new.clinician_id, 'signed_in', 'Signed in to their Perch page with an emailed code');
  return null;
end $$;
create trigger clinician_sessions_activity after insert on public.clinician_sessions
  for each row execute function private.log_clinician_session();

-- ---------------------------------------------------------------------------
-- Bookings: booked, moved and cancelled, on the family's and/or clinician's record
-- ---------------------------------------------------------------------------

create or replace function private.log_appointment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := case new.kind when 'signup_call' then 'Sign-up call' when 'clinician_intake' then 'Intake call' else 'Intro call' end;
  v_host text;
  v_kind text;
  v_summary text;
  v_detail jsonb := jsonb_build_object('appointment_id', new.id, 'call', new.kind, 'starts_at', new.starts_at, 'match_id', new.match_id);
begin
  if new.host_profile_id is not null then
    select full_name into v_host from public.profiles where id = new.host_profile_id;
  else
    select name into v_host from public.clinicians where id = new.host_clinician_id;
  end if;
  if tg_op = 'INSERT' then
    v_kind := 'call_booked';
    v_summary := v_label || ' booked for ' || private.fmt_time(new.starts_at) || coalesce(' with ' || v_host, '');
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    v_kind := 'call_cancelled';
    v_summary := v_label || ' on ' || private.fmt_time(new.starts_at) || ' cancelled' || coalesce(' (' || nullif(new.cancel_reason, '') || ')', '');
  elsif new.starts_at is distinct from old.starts_at then
    v_kind := 'call_moved';
    v_summary := v_label || ' moved from ' || private.fmt_time(old.starts_at) || ' to ' || private.fmt_time(new.starts_at) || coalesce(' with ' || v_host, '');
    v_detail := v_detail || jsonb_build_object('from', old.starts_at);
  else
    return null;
  end if;
  if new.family_id is not null then
    perform private.log_event('family', new.family_id, v_kind, v_summary, v_detail);
  end if;
  if new.clinician_id is not null then
    perform private.log_event('clinician', new.clinician_id, v_kind, v_summary, v_detail);
  end if;
  if new.host_clinician_id is not null then
    perform private.log_event('clinician', new.host_clinician_id, v_kind, v_summary, v_detail);
  end if;
  return null;
end $$;
create trigger appointments_activity after insert or update on public.appointments
  for each row execute function private.log_appointment_change();

-- ---------------------------------------------------------------------------
-- Referrals, intro calls and first sessions (on both records)
-- ---------------------------------------------------------------------------

create or replace function private.log_match_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_clinician text;
  v_suburb text;
  v_kind text;
  v_family_summary text;
  v_clinician_summary text;
  v_reason text := coalesce(' (' || nullif(new.response_reason, '') || ')', '');
  v_detail jsonb := jsonb_build_object('match_id', new.id, 'family_id', new.family_id, 'clinician_id', new.clinician_id,
                                       'reason', nullif(new.response_reason, ''));
begin
  if new.state = 'proposed' or (tg_op = 'UPDATE' and new.state = old.state) then
    return null;
  end if;
  select name into v_clinician from public.clinicians where id = new.clinician_id;
  select suburb into v_suburb from public.families where id = new.family_id;
  case new.state
    when 'offered' then
      v_kind := 'referral_offered';
      v_family_summary := 'Offered to ' || v_clinician || coalesce(' (reply by ' || private.fmt_time(new.offer_expires_at) || ')', '');
      v_clinician_summary := 'Referral offered: client in ' || coalesce(v_suburb, 'unknown suburb');
    when 'accepted' then
      v_kind := 'referral_accepted';
      v_family_summary := v_clinician || ' accepted the referral';
      v_clinician_summary := 'Accepted a referral: client in ' || coalesce(v_suburb, 'unknown suburb');
    when 'declined' then
      v_kind := 'referral_declined';
      v_family_summary := v_clinician || ' declined the referral' || v_reason;
      v_clinician_summary := 'Declined a referral: client in ' || coalesce(v_suburb, 'unknown suburb') || v_reason;
    when 'timeout' then
      v_kind := 'referral_expired';
      v_family_summary := v_clinician || ' didn''t reply to the referral in time';
      v_clinician_summary := 'Didn''t reply in time to a referral: client in ' || coalesce(v_suburb, 'unknown suburb');
    when 'withdrawn' then
      v_kind := 'referral_withdrawn';
      v_family_summary := 'Referral to ' || v_clinician || ' withdrawn' || v_reason;
      v_clinician_summary := 'Referral withdrawn: client in ' || coalesce(v_suburb, 'unknown suburb') || v_reason;
    else
      return null;
  end case;
  perform private.log_event('family', new.family_id, v_kind, v_family_summary, v_detail);
  perform private.log_event('clinician', new.clinician_id, v_kind, v_clinician_summary, v_detail);
  return null;
end $$;
create trigger matches_activity after insert or update on public.matches
  for each row execute function private.log_match_change();

create or replace function private.log_intro_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  v_summary text;
begin
  if new.outcome is null or (tg_op = 'UPDATE' and new.outcome is not distinct from old.outcome) then
    return null;
  end if;
  select * into m from public.matches where id = new.match_id;
  v_summary := 'Intro call: ' || replace(new.outcome::text, '_', ' ') || coalesce(' (' || nullif(new.reason, '') || ')', '');
  perform private.log_event('family', m.family_id, 'intro_outcome', v_summary, jsonb_build_object('match_id', m.id, 'outcome', new.outcome));
  perform private.log_event('clinician', m.clinician_id, 'intro_outcome', v_summary, jsonb_build_object('match_id', m.id, 'outcome', new.outcome));
  return null;
end $$;
create trigger intro_calls_activity after insert or update on public.intro_calls
  for each row execute function private.log_intro_outcome();

create or replace function private.log_conversion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  v_summary text := 'First session confirmed for ' || to_char(new.first_session_at, 'FMDD Mon YYYY');
begin
  if tg_op = 'UPDATE' and new.first_session_at = old.first_session_at then
    return null;
  end if;
  select * into m from public.matches where id = new.match_id;
  perform private.log_event('family', m.family_id, 'first_session', v_summary, jsonb_build_object('match_id', m.id, 'date', new.first_session_at));
  perform private.log_event('clinician', m.clinician_id, 'first_session', v_summary, jsonb_build_object('match_id', m.id, 'date', new.first_session_at));
  return null;
end $$;
create trigger conversions_activity after insert or update on public.conversions
  for each row execute function private.log_conversion();

-- Hours and days off are replaced wholesale, so they're logged by the functions that change them.
create or replace function public.save_clinician_availability(p_clinician uuid, p_timezone text, p_windows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff_or_service();
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = 'P0001';
  end if;
  update public.clinicians set timezone = p_timezone where id = p_clinician;
  perform private.replace_windows('clinician', p_clinician, p_windows);
  perform private.log_event('clinician', p_clinician, 'hours_updated',
    'Intro-call hours updated (' || jsonb_array_length(coalesce(p_windows, '[]')) || ' time blocks)',
    jsonb_build_object('windows', p_windows, 'timezone', p_timezone));
end $$;

create or replace function private.log_time_off() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.time_off := case when tg_op = 'DELETE' then old else new end;
begin
  if r.clinician_id is not null then
    perform private.log_event('clinician', r.clinician_id, case when tg_op = 'DELETE' then 'days_off_removed' else 'days_off_added' end,
      case when tg_op = 'DELETE' then 'Days off removed: ' else 'Days off added: ' end
        || to_char(r.starts_on, 'FMDD Mon YYYY') || case when r.ends_on <> r.starts_on then ' to ' || to_char(r.ends_on, 'FMDD Mon YYYY') else '' end,
      jsonb_build_object('starts_on', r.starts_on, 'ends_on', r.ends_on));
  end if;
  return null;
end $$;
create trigger time_off_activity after insert or delete on public.time_off
  for each row execute function private.log_time_off();

-- ---------------------------------------------------------------------------
-- The clinician workflow's statuses. The older recruitment steps (documents requested … orientation) are no
-- longer used; a clinician still in one can be moved back into the workflow.
-- ---------------------------------------------------------------------------

create or replace function private.clinician_transition_allowed(p_from public.clinician_status, p_to public.clinician_status)
returns boolean
language sql immutable set search_path = '' as $$
  select p_to = 'offboarded' and p_from <> 'offboarded' or case p_from
    when 'applied'   then p_to in ('screening', 'active')
    when 'screening' then p_to in ('applied', 'active')
    when 'active'    then p_to in ('paused')
    when 'paused'    then p_to in ('active')
    when 'offboarded' then false
    else p_to in ('applied', 'screening', 'active')   -- older recruitment steps
  end
$$;

-- ---------------------------------------------------------------------------
-- Backfill what already happened, from the records we have.
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('app.actor', 'system', true);

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select 'family', id, created_at, 'enquiry', 'Enquiry submitted', jsonb_build_object('backfilled', true), 'family' from public.families;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select 'family', family_id, granted_at, 'consent', 'Consent given: ' || replace(type, '_', ' ') || ' (version ' || version || ')',
         jsonb_build_object('type', type, 'version', version, 'backfilled', true), 'family' from public.consents;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select 'clinician', id, created_at, 'signed_up', 'Signed up to join the network', jsonb_build_object('backfilled', true), 'clinician'
    from public.clinicians;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select 'clinician', id, application_submitted_at, 'application_submitted', 'Application submitted (service agreement accepted)',
         jsonb_build_object('backfilled', true), 'clinician'
    from public.clinicians where application_submitted_at is not null;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  select sh.entity_type, sh.entity_id, sh.at, 'status',
         'Status: ' || coalesce(sh.from_status || ' → ', '') || sh.to_status || coalesce(' (' || nullif(sh.reason, '') || ')', ''),
         jsonb_build_object('from', sh.from_status, 'to', sh.to_status, 'reason', nullif(sh.reason, ''), 'backfilled', true),
         case when sh.by is not null and exists (select 1 from public.profiles p where p.id = sh.by and p.role <> 'clinician') then 'staff' else 'system' end,
         case when sh.by is not null and exists (select 1 from public.profiles p where p.id = sh.by and p.role <> 'clinician') then sh.by end
    from public.status_history sh;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  select 'clinician', cr.clinician_id, cr.created_at,
         case when cr.sighted_only then 'document_sighted' else 'document_uploaded' end,
         replace(cr.type::text, '_', ' ') || case when cr.sighted_only then ' sighted by the team' else ' uploaded' end,
         jsonb_build_object('credential_id', cr.id, 'type', cr.type, 'expires_at', cr.expires_at, 'backfilled', true),
         case when cr.sighted_only or exists (select 1 from public.profiles p where p.id = cr.uploaded_by and p.role <> 'clinician') then 'staff' else 'clinician' end,
         case when cr.sighted_only then cr.verified_by end
    from public.credentials cr;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  select 'clinician', cr.clinician_id, cr.verified_at, 'document_' || cr.status::text,
         replace(cr.type::text, '_', ' ') || ' ' || cr.status::text || coalesce(' (' || nullif(cr.rejection_reason, '') || ')', ''),
         jsonb_build_object('credential_id', cr.id, 'type', cr.type, 'expires_at', cr.expires_at, 'backfilled', true),
         case when cr.verified_by is not null then 'staff' else 'system' end, cr.verified_by
    from public.credentials cr where cr.verified_at is not null and cr.status in ('verified', 'rejected', 'expired');

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select 'clinician', clinician_id, signed_at, 'agreement_signed', 'Service agreement signed (version ' || version || ')',
         jsonb_build_object('version', version, 'backfilled', true), 'clinician'
    from public.agreements where signed_at is not null;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select e.entity_type, e.entity_id, a.created_at, 'call_booked',
         case a.kind when 'signup_call' then 'Sign-up call' when 'clinician_intake' then 'Intake call' else 'Intro call' end
           || ' booked for ' || private.fmt_time(a.starts_at) || coalesce(' with ' || coalesce(p.full_name, hc.name), ''),
         jsonb_build_object('appointment_id', a.id, 'call', a.kind, 'starts_at', a.starts_at, 'backfilled', true),
         case when a.kind = 'clinician_intake' then 'clinician' else 'family' end
    from public.appointments a
    left join public.profiles p on p.id = a.host_profile_id
    left join public.clinicians hc on hc.id = a.host_clinician_id
    cross join lateral (values ('family', a.family_id), ('clinician', a.clinician_id), ('clinician', a.host_clinician_id)) e(entity_type, entity_id)
   where e.entity_id is not null;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select e.entity_type, e.entity_id, a.cancelled_at, 'call_cancelled',
         case a.kind when 'signup_call' then 'Sign-up call' when 'clinician_intake' then 'Intake call' else 'Intro call' end
           || ' on ' || private.fmt_time(a.starts_at) || ' cancelled' || coalesce(' (' || nullif(a.cancel_reason, '') || ')', ''),
         jsonb_build_object('appointment_id', a.id, 'call', a.kind, 'backfilled', true), 'system'
    from public.appointments a
    cross join lateral (values ('family', a.family_id), ('clinician', a.clinician_id), ('clinician', a.host_clinician_id)) e(entity_type, entity_id)
   where e.entity_id is not null and a.cancelled_at is not null;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  select e.entity_type, e.entity_id, m.offered_at, 'referral_offered',
         case e.entity_type when 'family' then 'Offered to ' || c.name else 'Referral offered: client in ' || coalesce(f.suburb, 'unknown suburb') end,
         jsonb_build_object('match_id', m.id, 'family_id', m.family_id, 'clinician_id', m.clinician_id, 'backfilled', true),
         case when m.approved_by is not null then 'staff' else 'system' end, m.approved_by
    from public.matches m join public.clinicians c on c.id = m.clinician_id join public.families f on f.id = m.family_id
    cross join lateral (values ('family', m.family_id), ('clinician', m.clinician_id)) e(entity_type, entity_id)
   where m.offered_at is not null;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select e.entity_type, e.entity_id, m.responded_at, 'referral_' || case m.state::text when 'timeout' then 'expired' else m.state::text end,
         case e.entity_type when 'family' then c.name || ' ' || m.state::text else 'Referral ' || m.state::text || ': client in ' || coalesce(f.suburb, 'unknown suburb') end
           || coalesce(' (' || nullif(m.response_reason, '') || ')', ''),
         jsonb_build_object('match_id', m.id, 'family_id', m.family_id, 'clinician_id', m.clinician_id, 'backfilled', true), 'system'
    from public.matches m join public.clinicians c on c.id = m.clinician_id join public.families f on f.id = m.family_id
    cross join lateral (values ('family', m.family_id), ('clinician', m.clinician_id)) e(entity_type, entity_id)
   where m.responded_at is not null and m.state in ('accepted', 'declined', 'timeout');

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select e.entity_type, e.entity_id, cv.confirmed_at, 'first_session', 'First session confirmed for ' || to_char(cv.first_session_at, 'FMDD Mon YYYY'),
         jsonb_build_object('match_id', m.id, 'backfilled', true), 'system'
    from public.conversions cv join public.matches m on m.id = cv.match_id
    cross join lateral (values ('family', m.family_id), ('clinician', m.clinician_id)) e(entity_type, entity_id);

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind)
  select e.entity_type, e.entity_id, coalesce(ic.recorded_at, ic.created_at), 'intro_outcome',
         'Intro call: ' || replace(ic.outcome::text, '_', ' ') || coalesce(' (' || nullif(ic.reason, '') || ')', ''),
         jsonb_build_object('match_id', m.id, 'backfilled', true), 'system'
    from public.intro_calls ic join public.matches m on m.id = ic.match_id
    cross join lateral (values ('family', m.family_id), ('clinician', m.clinician_id)) e(entity_type, entity_id)
   where ic.outcome is not null;

  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  select 'family', ic.family_id, ic.completed_at, 'signup_call_recorded',
         'Sign-up call recorded' || coalesce(': ' || replace(ic.outcome::text, '_', ' '), ''),
         jsonb_build_object('backfilled', true), case when ic.coordinator_id is not null then 'staff' else 'system' end, ic.coordinator_id
    from public.intake_calls ic where ic.completed_at is not null;
end $$;
