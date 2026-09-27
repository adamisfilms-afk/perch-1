-- The Switchboard: business rules
--
-- State changes that must never be skipped (status history, the go-live gate,
-- automatic pausing, referral offers) are enforced here in the database, so they
-- hold no matter which part of the app, cron job or webhook makes the change.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Australia/Sydney')::date
$$;

create or replace function private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.settings where key = p_key
$$;

create or replace function private.setting_int(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::integer from public.settings where key = p_key
$$;

create or replace function private.setting_text(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value #>> '{}' from public.settings where key = p_key
$$;

create or replace function private.request_ip() returns text
language sql stable set search_path = '' as $$
  select nullif(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for',
    current_setting('request.headers', true)::json ->> 'x-real-ip', ''), ',', 1), '')
$$;

create or replace function private.age_years(p_dob date, p_age smallint) returns integer
language sql stable set search_path = '' as $$
  select case when p_dob is not null
    then extract(year from age(private.today(), p_dob))::integer
    else p_age::integer end
$$;

create or replace function private.new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function private.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- Who is calling?
-- Every role check also requires multi-factor login (aal2) when require_mfa is on,
-- so a stolen password alone never reaches family data, even through the API.
-- ---------------------------------------------------------------------------

create or replace function private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or coalesce((select (value #>> '{}')::boolean from public.settings where key = 'require_mfa'), true) = false
$$;

create or replace function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active and private.mfa_satisfied()
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() in ('admin', 'coordinator', 'clinical_lead'), false)
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

create or replace function private.can_approve_complex() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() in ('admin', 'clinical_lead'), false)
$$;

create or replace function private.current_clinician_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clinicians c
  where c.user_id = auth.uid()
    and c.status <> 'offboarded'              -- access ends immediately on off-boarding
    and private.current_app_role() = 'clinician'
$$;

-- True when the request came from our own server with the service role key.
create or replace function private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

create or replace function private.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'Only staff can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Messaging (outbox). The app sends queued rows; see src/lib/notifications.
-- ---------------------------------------------------------------------------

create or replace function private.enqueue(
  p_template text, p_channel public.message_channel, p_recipient text,
  p_kind text, p_recipient_id uuid, p_payload jsonb, p_at timestamptz default now()
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null or btrim(p_recipient) = '' then
    return;
  end if;
  insert into public.message_log (template, channel, recipient, recipient_kind, recipient_id, payload, scheduled_for)
  values (p_template, p_channel, p_recipient, p_kind, p_recipient_id, coalesce(p_payload, '{}'), p_at);
end $$;

create or replace function private.notify_staff(p_template text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue(p_template, 'email', private.setting_text('staff_alert_email'), 'staff', null, p_payload);
  perform private.enqueue(p_template, 'slack', 'coordinators', 'staff', null, p_payload);
end $$;

create or replace function private.notify_family(p_template text, p_family uuid, p_payload jsonb,
  p_channels public.message_channel[] default array['email', 'sms']::public.message_channel[],
  p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
begin
  select * into f from public.families where id = p_family;
  if not found or f.anonymised_at is not null then
    return;
  end if;
  p_payload := jsonb_build_object('family_id', f.id, 'parent_name', f.parent_name,
                                  'parent_first_name', split_part(f.parent_name, ' ', 1)) || coalesce(p_payload, '{}');
  if 'email' = any (p_channels) then
    perform private.enqueue(p_template, 'email', f.email, 'family', f.id, p_payload, p_at);
  end if;
  if 'sms' = any (p_channels) then
    perform private.enqueue(p_template, 'sms', f.mobile, 'family', f.id, p_payload, p_at);
  end if;
end $$;

create or replace function private.notify_clinician(p_template text, p_clinician uuid, p_payload jsonb,
  p_channels public.message_channel[] default array['email']::public.message_channel[],
  p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  select * into c from public.clinicians where id = p_clinician;
  if not found then
    return;
  end if;
  p_payload := jsonb_build_object('clinician_id', c.id, 'clinician_name', c.name,
                                  'clinician_first_name', split_part(c.name, ' ', 1)) || coalesce(p_payload, '{}');
  if 'email' = any (p_channels) then
    perform private.enqueue(p_template, 'email', c.email, 'clinician', c.id, p_payload, p_at);
  end if;
  if 'sms' = any (p_channels) then
    perform private.enqueue(p_template, 'sms', c.mobile, 'clinician', c.id, p_payload, p_at);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Generic triggers: updated_at and audit log
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Records who changed what (column names only: never the values, to keep the log free of health data).
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_detail jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
  else
    v_id := new.id;
  end if;
  if tg_op = 'UPDATE' then
    select jsonb_build_object('changed', coalesce(jsonb_agg(n.key order by n.key), '[]'))
      into v_detail
      from jsonb_each(to_jsonb(new)) n
     where n.key not in ('updated_at')
       and n.value is distinct from to_jsonb(old) -> n.key;
    if v_detail -> 'changed' = '[]'::jsonb then
      return null;
    end if;
  end if;
  insert into public.audit_log (user_id, action, entity_type, entity_id, detail, ip)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_detail, private.request_ip());
  return null;
end $$;

-- Explicit logging for views, downloads and exports (called by the app).
create or replace function public.log_access(p_entity_type text, p_entity_id uuid, p_action text default 'view')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.current_app_role() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_action not in ('view', 'download', 'export') then
    raise exception 'Unknown action %', p_action;
  end if;
  insert into public.audit_log (user_id, action, entity_type, entity_id, ip)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, private.request_ip());
end $$;

-- ---------------------------------------------------------------------------
-- Family pipeline status machine
-- ---------------------------------------------------------------------------

create or replace function private.family_transition_allowed(p_from public.family_status, p_to public.family_status)
returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'new'            then p_to in ('contacted', 'intake_booked', 'intake_done', 'lost', 'not_suitable', 'withdrawn')
    when 'contacted'      then p_to in ('intake_booked', 'intake_done', 'lost', 'not_suitable', 'withdrawn')
    when 'intake_booked'  then p_to in ('intake_done', 'contacted', 'lost', 'not_suitable', 'withdrawn')
    when 'intake_done'    then p_to in ('ready_to_match', 'contacted', 'not_suitable', 'lost', 'withdrawn')
    when 'ready_to_match' then p_to in ('offered', 'waitlist', 'lost', 'withdrawn')
    when 'offered'        then p_to in ('accepted', 'ready_to_match', 'waitlist', 'lost', 'withdrawn')
    when 'accepted'       then p_to in ('intro_booked', 'intro_done', 'converted', 'ready_to_match', 'lost', 'withdrawn')
    when 'intro_booked'   then p_to in ('intro_done', 'converted', 'accepted', 'ready_to_match', 'lost', 'withdrawn')
    when 'intro_done'     then p_to in ('converted', 'ready_to_match', 'lost', 'withdrawn')
    when 'waitlist'       then p_to in ('ready_to_match', 'offered', 'lost', 'not_suitable', 'withdrawn')
    when 'lost'           then p_to in ('contacted')
    when 'not_suitable'   then p_to in ('contacted')
    when 'withdrawn'      then p_to in ('contacted')
    when 'converted'      then false
  end
$$;

-- BEFORE trigger: runs as the caller so admin override can be detected.
create or replace function private.family_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if not private.family_transition_allowed(old.status, new.status) and not private.is_admin() then
      raise exception 'A family cannot move from "%" to "%"', old.status, new.status using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    new.status_reason := nullif(current_setting('app.status_reason', true), '');
    if new.status <> 'waitlist' then
      new.waitlist_reason := null;
      new.waitlist_codes := '{}';
    end if;
  end if;
  return new;
end $$;

create or replace function private.family_status_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.status_history (entity_type, entity_id, from_status, to_status, reason, by)
    values ('family', new.id, case when tg_op = 'UPDATE' then old.status::text end, new.status::text,
            nullif(current_setting('app.status_reason', true), ''), auth.uid());
  end if;
  return null;
end $$;

create or replace function private.set_family_status(p_family uuid, p_status public.family_status, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.families set status = p_status where id = p_family and status is distinct from p_status;
  perform set_config('app.status_reason', '', true);
end $$;

create or replace function public.set_family_status(p_family uuid, p_status public.family_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_status in ('lost', 'not_suitable', 'withdrawn') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Please give a reason' using errcode = 'P0001';
  end if;
  if p_status = 'offered' then
    raise exception 'Families move to Offered when an approved shortlist is sent' using errcode = 'P0001';
  end if;
  -- leaving the matching part of the funnel withdraws any outstanding offers
  if p_status in ('lost', 'not_suitable', 'withdrawn') then
    update public.matches set state = 'withdrawn', response_reason = 'Family ' || p_status::text
     where family_id = p_family and state in ('proposed', 'offered');
  end if;
  perform private.set_family_status(p_family, p_status, p_reason);
  if p_status = 'not_suitable' then
    perform private.notify_family('not_suitable', p_family, jsonb_build_object('reason', p_reason), array['email']::public.message_channel[]);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Clinician lifecycle status machine and go-live gate
-- ---------------------------------------------------------------------------

create or replace function private.clinician_transition_allowed(p_from public.clinician_status, p_to public.clinician_status)
returns boolean
language sql immutable set search_path = '' as $$
  select p_to = 'offboarded' and p_from <> 'offboarded' or case p_from
    when 'applied'             then p_to in ('screening', 'documents_requested')
    when 'screening'           then p_to in ('documents_requested', 'applied')
    when 'documents_requested' then p_to in ('documents_verified', 'agreement_signed')
    when 'documents_verified'  then p_to in ('agreement_signed', 'documents_requested', 'onboarding')
    when 'agreement_signed'    then p_to in ('documents_verified', 'onboarding', 'orientation', 'active')
    when 'onboarding'          then p_to in ('orientation', 'active')
    when 'orientation'         then p_to in ('active', 'onboarding')
    when 'active'              then p_to in ('paused')
    when 'paused'              then p_to in ('active')
    else false
  end
$$;

create or replace function private.required_credential_types(p_profession public.profession, p_home_visits boolean)
returns public.credential_type[]
language sql immutable set search_path = '' as $$
  select array['wwcc', 'ndis_worker_screening', 'ndis_orientation', 'pi_insurance', 'pl_insurance', 'abn']::public.credential_type[]
      || case when p_profession = 'speech_pathologist'
              then array['spa_cpsp']::public.credential_type[]
              else array['ahpra']::public.credential_type[] end
      || case when p_home_visits
              then array['drivers_licence', 'car_insurance']::public.credential_type[]
              else '{}'::public.credential_type[] end
$$;

create or replace function private.expiry_tracked(p_type public.credential_type) returns boolean
language sql immutable set search_path = '' as $$
  select p_type in ('spa_cpsp', 'ahpra', 'wwcc', 'ndis_worker_screening', 'pi_insurance', 'pl_insurance',
                    'ndis_registration', 'drivers_licence', 'car_insurance')
$$;

-- Required credential types that are not currently verified and in date.
create or replace function private.credential_gaps(p_clinician uuid, p_profession public.profession, p_home_visits boolean)
returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t::text order by t::text), '{}')
  from unnest(private.required_credential_types(p_profession, p_home_visits)) as t
  where not exists (
    select 1 from public.credentials cr
    where cr.clinician_id = p_clinician and cr.type = t and cr.status = 'verified'
      and (cr.expires_at is null or cr.expires_at >= private.today())
  )
$$;

-- Everything standing between a clinician and Active. Empty array = ready.
create or replace function private.go_live_gaps(c public.clinicians) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  gaps text[] := '{}';
begin
  gaps := gaps || array(select 'credential:' || g from unnest(private.credential_gaps(c.id, c.profession, c.home_visits)) g);
  if not exists (select 1 from public.agreements a where a.clinician_id = c.id and a.signed_at is not null) then
    gaps := gaps || 'agreement'::text;
  end if;
  if c.clinical_lead_approved_at is null then
    gaps := gaps || 'clinical_lead_approval'::text;
  end if;
  if c.calcom_intro_url is null then
    gaps := gaps || 'calcom_intro_url'::text;
  end if;
  if c.user_id is null then
    gaps := gaps || 'portal_account'::text;
  end if;
  if (c.base_lat is null or c.radius_km is null) and cardinality(c.service_postcodes) = 0 then
    gaps := gaps || 'service_area'::text;
  end if;
  if cardinality(c.age_groups) = 0 then
    gaps := gaps || 'age_groups'::text;
  end if;
  if cardinality(c.funding_types) = 0 then
    gaps := gaps || 'funding_types'::text;
  end if;
  if not exists (select 1 from public.availability a where a.clinician_id = c.id) then
    gaps := gaps || 'availability'::text;
  end if;
  return gaps;
end $$;

create or replace function public.clinician_go_live_gaps(p_clinician uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  if not (private.is_staff() or private.current_clinician_id() = p_clinician) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician;
  return private.go_live_gaps(c);
end $$;

-- Clinicians may edit their own profile, capacity and availability, but never
-- their status, approval, verification or payment fields. Runs as the caller:
-- inside our own security-definer functions current_user is the owner, not `authenticated`.
create or replace function private.clinician_self_edit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_staff() then
    if new.status is distinct from old.status
       or new.pause_reason is distinct from old.pause_reason
       or new.user_id is distinct from old.user_id
       or new.email is distinct from old.email
       or new.profession is distinct from old.profession
       or new.ndis_registered is distinct from old.ndis_registered
       or new.abn is distinct from old.abn
       or new.clinical_lead_approved_by is distinct from old.clinical_lead_approved_by
       or new.clinical_lead_approved_at is distinct from old.clinical_lead_approved_at
       or new.stripe_account_id is distinct from old.stripe_account_id
       or new.halaxy_ref is distinct from old.halaxy_ref
       or new.screening_notes is distinct from old.screening_notes
       or new.application is distinct from old.application then
      raise exception 'Please ask the team to change that for you' using errcode = '42501';
    end if;
    -- agency-managed NDIS funding needs verified NDIS registration
    if 'ndis_agency_managed' = any (new.funding_types) and not new.ndis_registered then
      raise exception 'Agency-managed NDIS families can only be seen by NDIS-registered clinicians' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function private.clinician_status_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  gaps text[];
begin
  if new.status is distinct from old.status then
    if not private.clinician_transition_allowed(old.status, new.status) and not private.is_admin() then
      raise exception 'A clinician cannot move from "%" to "%"', old.status, new.status using errcode = 'P0001';
    end if;
    -- Go-live gate: documents verified, agreement signed, clinical lead approved.
    if new.status = 'active' then
      gaps := private.go_live_gaps(new);
      if cardinality(gaps) > 0 then
        raise exception 'Not ready to go live: %', array_to_string(gaps, ', ') using errcode = 'P0001';
      end if;
    end if;
    if new.status <> 'paused' then
      new.pause_reason := null;
    end if;
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create or replace function private.clinician_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(current_setting('app.status_reason', true), '');
  v_waitlisted integer;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.status_history (entity_type, entity_id, from_status, to_status, reason, by)
    values ('clinician', new.id, case when tg_op = 'UPDATE' then old.status::text end,
            new.status::text || case when new.status = 'paused' then ' (' || new.pause_reason::text || ')' else '' end,
            v_reason, auth.uid());
  end if;
  if tg_op = 'INSERT' then
    return null;
  end if;

  if new.status = 'paused' and old.status is distinct from 'paused' then
    perform private.notify_clinician('clinician_paused', new.id,
      jsonb_build_object('pause_reason', new.pause_reason, 'reason', v_reason));
    perform private.notify_staff('clinician_paused_staff',
      jsonb_build_object('clinician_id', new.id, 'clinician_name', new.name, 'pause_reason', new.pause_reason, 'reason', v_reason));
    -- no new referrals: pull any offers that haven't been answered yet
    update public.matches set state = 'withdrawn', response_reason = 'Clinician paused'
     where clinician_id = new.id and state = 'offered';
  end if;

  if new.status = 'active' and old.status = 'paused' then
    perform private.notify_clinician('clinician_reactivated', new.id, '{}');
    perform private.notify_staff('clinician_reactivated_staff',
      jsonb_build_object('clinician_id', new.id, 'clinician_name', new.name));
  end if;

  if new.status = 'offboarded' then
    update public.matches set state = 'withdrawn', response_reason = 'Clinician off-boarded'
     where clinician_id = new.id and state in ('proposed', 'offered');
    insert into public.offboarding_checklists (clinician_id) values (new.id) on conflict do nothing;
  end if;

  -- Capacity freed up or a new clinician went live: re-check the waitlist.
  if new.status = 'active' and (
       old.status <> 'active'
       or new.capacity_new > old.capacity_new
       or (old.snoozed_until is not null and new.snoozed_until is null)
       or new.radius_km > old.radius_km
       or new.funding_types <> old.funding_types
       or new.age_groups <> old.age_groups) then
    select count(*) into v_waitlisted from public.families where status = 'waitlist';
    if v_waitlisted > 0 then
      perform private.notify_staff('waitlist_recheck',
        jsonb_build_object('clinician_id', new.id, 'clinician_name', new.name, 'waitlist_count', v_waitlisted));
    end if;
  end if;
  return null;
end $$;

create or replace function public.set_clinician_status(p_clinician uuid, p_status public.clinician_status,
  p_pause_reason public.pause_reason default null, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_status = 'paused' and p_pause_reason is null then
    raise exception 'Choose why the clinician is paused' using errcode = 'P0001';
  end if;
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.clinicians
     set status = p_status,
         pause_reason = case when p_status = 'paused' then p_pause_reason end
   where id = p_clinician;
  perform set_config('app.status_reason', '', true);
end $$;

create or replace function public.approve_clinician(p_clinician uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_approve_complex() then
    raise exception 'Only a clinical lead can approve a clinician to go live' using errcode = '42501';
  end if;
  update public.clinicians
     set clinical_lead_approved_by = auth.uid(), clinical_lead_approved_at = now()
   where id = p_clinician;
end $$;

-- ---------------------------------------------------------------------------
-- Credentials: verification, automatic pause and reactivation
-- ---------------------------------------------------------------------------

create or replace function private.credential_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_staff() then
    -- a clinician's upload always starts in the verification queue
    new.status := 'pending';
    new.verified_by := null;
    new.verified_at := null;
    new.sighted_only := false;
    new.uploaded_by := auth.uid();
    if new.type in ('drivers_licence', 'car_insurance') then
      raise exception 'Please don''t upload a copy of this: the team will sight it' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- After a credential is verified: reactivate or advance the clinician if they're now clear.
create or replace function private.after_credentials_change(p_clinician uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  select * into c from public.clinicians where id = p_clinician for update;
  if c.status = 'paused' and c.pause_reason = 'credentials'
     and cardinality(private.go_live_gaps(c)) = 0 then
    perform set_config('app.status_reason', 'Credentials verified', true);
    update public.clinicians set status = 'active' where id = c.id;
    perform set_config('app.status_reason', '', true);
  elsif c.status = 'documents_requested'
     and cardinality(private.credential_gaps(c.id, c.profession, c.home_visits)) = 0 then
    perform set_config('app.status_reason', 'All required documents verified', true);
    update public.clinicians set status = 'documents_verified' where id = c.id;
    perform set_config('app.status_reason', '', true);
  end if;
end $$;

create or replace function public.verify_credential(p_credential uuid, p_approve boolean,
  p_reason text default null, p_expires_at date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cr public.credentials;
begin
  perform private.require_staff();
  select * into cr from public.credentials where id = p_credential for update;
  if not found then
    raise exception 'Document not found';
  end if;
  if cr.status <> 'pending' then
    raise exception 'This document has already been reviewed' using errcode = 'P0001';
  end if;

  if p_approve then
    if private.expiry_tracked(cr.type) and coalesce(p_expires_at, cr.expires_at) is null then
      raise exception 'Enter the expiry date before verifying' using errcode = 'P0001';
    end if;
    if coalesce(p_expires_at, cr.expires_at) < private.today() then
      raise exception 'This document has already expired' using errcode = 'P0001';
    end if;
    update public.credentials set status = 'superseded'
     where clinician_id = cr.clinician_id and type = cr.type and status in ('verified', 'expired') and id <> cr.id;
    update public.credentials
       set status = 'verified', verified_by = auth.uid(), verified_at = now(), last_checked_at = now(),
           expires_at = coalesce(p_expires_at, expires_at), rejection_reason = null
     where id = cr.id;
    if cr.type = 'ndis_registration' then
      update public.clinicians set ndis_registered = true where id = cr.clinician_id;
    end if;
    perform private.after_credentials_change(cr.clinician_id);
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Say why the document can''t be accepted' using errcode = 'P0001';
    end if;
    update public.credentials set status = 'rejected', rejection_reason = p_reason, verified_by = auth.uid()
     where id = cr.id;
    perform private.notify_clinician('credential_rejected', cr.clinician_id,
      jsonb_build_object('credential_type', cr.type, 'reason', p_reason));
  end if;
end $$;

-- ID-type documents: record that they were sighted, when, and by whom. No copy is stored.
create or replace function public.record_sighted_credential(p_clinician uuid, p_type public.credential_type,
  p_sighted_at date, p_expires_at date default null, p_number text default null, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_staff();
  if private.expiry_tracked(p_type) and p_expires_at is null then
    raise exception 'Enter the expiry date' using errcode = 'P0001';
  end if;
  update public.credentials set status = 'superseded'
   where clinician_id = p_clinician and type = p_type and status in ('verified', 'expired', 'pending');
  insert into public.credentials (clinician_id, type, number, expires_at, sighted_only, sighted_at, notes,
                                  status, verified_by, verified_at, last_checked_at)
  values (p_clinician, p_type, p_number, p_expires_at, true, p_sighted_at, p_notes,
          'verified', auth.uid(), now(), now())
  returning id into v_id;
  perform private.after_credentials_change(p_clinician);
  return v_id;
end $$;

-- Called by the app after an automatic ABN Lookup check.
create or replace function public.record_abn_check(p_clinician uuid, p_abn text, p_active boolean, p_entity_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.credentials;
begin
  if not (private.is_service() or private.is_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_existing from public.credentials
   where clinician_id = p_clinician and type = 'abn' and status in ('verified', 'expired') order by created_at desc limit 1;
  if p_active then
    if found and v_existing.number = p_abn then
      update public.credentials set last_checked_at = now(), status = 'verified', issuer = p_entity_name
       where id = v_existing.id;
    else
      update public.credentials set status = 'superseded'
       where clinician_id = p_clinician and type = 'abn' and status in ('verified', 'expired', 'pending');
      insert into public.credentials (clinician_id, type, number, issuer, status, verified_at, last_checked_at, notes)
      values (p_clinician, 'abn', p_abn, p_entity_name, 'verified', now(), now(), 'Checked automatically against ABN Lookup');
    end if;
    update public.clinicians set abn = p_abn where id = p_clinician;
    perform private.after_credentials_change(p_clinician);
  else
    if found then
      update public.credentials set status = 'expired', last_checked_at = now(),
             notes = 'ABN Lookup shows this ABN is not active'
       where id = v_existing.id;
      perform private.pause_for_credentials(p_clinician, 'ABN no longer active');
    end if;
  end if;
end $$;

create or replace function private.pause_for_credentials(p_clinician uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  select * into c from public.clinicians where id = p_clinician for update;
  if c.status = 'active'
     and cardinality(private.credential_gaps(c.id, c.profession, c.home_visits)) > 0 then
    perform set_config('app.status_reason', p_reason, true);
    update public.clinicians set status = 'paused', pause_reason = 'credentials' where id = c.id;
    perform set_config('app.status_reason', '', true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Referral offers
-- ---------------------------------------------------------------------------

-- Save the rule-based (or AI-assisted) shortlist a coordinator has picked.
-- p_items: [{clinician_id, rank, rule_score, score_breakdown, distance_km, ai_rank, ai_reason}]
create or replace function public.propose_shortlist(p_child uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
begin
  perform private.require_staff();
  select fam.* into f from public.families fam join public.children ch on ch.family_id = fam.id
   where ch.id = p_child for update of fam;
  if not found then
    raise exception 'Child not found';
  end if;
  if f.status not in ('ready_to_match', 'waitlist', 'offered') then
    raise exception 'Finish the intake before matching (family is "%")', f.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches where child_id = p_child and state in ('offered', 'accepted')) then
    raise exception 'An offer is already out for this child' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'Pick at least one clinician' using errcode = 'P0001';
  end if;

  update public.matches set state = 'withdrawn', response_reason = 'Replaced by a new shortlist'
   where child_id = p_child and state = 'proposed';

  insert into public.matches (family_id, child_id, clinician_id, rank, rule_score, score_breakdown,
                              distance_km, ai_rank, ai_reason, proposed_by)
  select f.id, p_child, x.clinician_id, x.rank, x.rule_score, coalesce(x.score_breakdown, '{}'),
         x.distance_km, x.ai_rank, x.ai_reason, auth.uid()
    from jsonb_to_recordset(p_items) as x(clinician_id uuid, rank smallint, rule_score numeric,
                                          score_breakdown jsonb, distance_km numeric, ai_rank smallint, ai_reason text);
end $$;

-- A person approves the shortlist; offers then go out in rank order.
create or replace function public.approve_shortlist(p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
begin
  perform private.require_staff();
  if auth.uid() is null then
    raise exception 'A person must approve every match';
  end if;
  select fam.* into f from public.families fam join public.children ch on ch.family_id = fam.id where ch.id = p_child;
  if f.complex_case and not private.can_approve_complex() then
    raise exception 'This is a complex case: a clinical lead needs to approve the match' using errcode = '42501';
  end if;
  update public.matches set approved_by = auth.uid(), approved_at = now()
   where child_id = p_child and state = 'proposed' and approved_at is null;
  if not found then
    raise exception 'There is no shortlist waiting for approval' using errcode = 'P0001';
  end if;
  perform private.advance_offers(p_child);
end $$;

-- Send offers until the configured number are out (1 in sequential mode, N in parallel mode).
create or replace function private.advance_offers(p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
  v_child public.children;
  v_slots integer;
  v_out integer;
  v_hours integer := coalesce(private.setting_int('offer_response_hours'), 48);
  m record;
begin
  select fam.* into f from public.families fam join public.children ch on ch.family_id = fam.id
   where ch.id = p_child for update of fam;
  select * into v_child from public.children where id = p_child;
  if exists (select 1 from public.matches where child_id = p_child and state = 'accepted') then
    return;
  end if;
  if f.status not in ('ready_to_match', 'waitlist', 'offered') then
    return;
  end if;

  v_slots := case when private.setting_text('offer_mode') = 'parallel'
                  then greatest(coalesce(private.setting_int('parallel_offer_count'), 3), 1) else 1 end;
  select count(*) into v_out from public.matches where child_id = p_child and state = 'offered';

  for m in
    select mt.id, mt.clinician_id, c.status as c_status, c.capacity_new, c.snoozed_until
      from public.matches mt join public.clinicians c on c.id = mt.clinician_id
     where mt.child_id = p_child and mt.state = 'proposed' and mt.approved_at is not null
     order by mt.rank, mt.proposed_at
  loop
    exit when v_out >= v_slots;
    if m.c_status <> 'active' or m.capacity_new <= 0
       or (m.snoozed_until is not null and m.snoozed_until >= private.today()) then
      update public.matches set state = 'withdrawn', response_reason = 'Clinician no longer available when the offer was due'
       where id = m.id;
      continue;
    end if;
    update public.matches
       set state = 'offered', offered_at = now(), offer_expires_at = now() + make_interval(hours => v_hours)
     where id = m.id;
    v_out := v_out + 1;
    perform private.notify_clinician('offer_sent', m.clinician_id,
      jsonb_build_object('match_id', m.id, 'suburb', f.suburb,
                         'child_age', private.age_years(v_child.dob, v_child.age_years),
                         'response_hours', v_hours),
      array['email', 'sms']::public.message_channel[]);
  end loop;

  if v_out > 0 then
    perform private.set_family_status(f.id, 'offered', null);
  else
    if f.status = 'offered' then
      perform private.set_family_status(f.id, 'ready_to_match', 'No clinician on the shortlist accepted');
    end if;
    perform private.notify_staff('shortlist_exhausted',
      jsonb_build_object('family_id', f.id, 'child_first_name', v_child.first_name, 'suburb', f.suburb));
  end if;
end $$;

-- Clinician accepts or declines. Accepting is always a person's choice: never automated.
create or replace function public.respond_to_offer(p_match uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinician uuid := private.current_clinician_id();
  m public.matches;
  c public.clinicians;
  v_child public.children;
  o record;
begin
  if v_clinician is null then
    raise exception 'Only the clinician who received the offer can respond' using errcode = '42501';
  end if;
  select * into m from public.matches where id = p_match and clinician_id = v_clinician;
  if not found then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  -- lock the family first (same order as advance_offers) so parallel accepts can't both win
  perform 1 from public.families where id = m.family_id for update;
  select * into m from public.matches where id = p_match for update;
  if m.state <> 'offered' then
    raise exception 'This offer is no longer open' using errcode = 'P0001';
  end if;
  if m.offer_expires_at < now() then
    raise exception 'This offer has expired' using errcode = 'P0001';
  end if;

  if p_accept then
    update public.matches set state = 'accepted', responded_at = now(), response_reason = p_reason where id = m.id;
    for o in
      update public.matches set state = 'withdrawn', response_reason = 'Another clinician accepted'
       where child_id = m.child_id and state in ('offered', 'proposed') and id <> m.id
      returning clinician_id, (offered_at is not null) as was_offered
    loop
      if o.was_offered then
        perform private.notify_clinician('offer_withdrawn', o.clinician_id, '{}');
      end if;
    end loop;
    update public.clinicians set capacity_new = greatest(capacity_new - 1, 0)
     where id = v_clinician returning * into c;
    perform private.set_family_status(m.family_id, 'accepted', null);
    select * into v_child from public.children where id = m.child_id;
    perform private.notify_family('match_confirmed', m.family_id,
      jsonb_build_object('match_id', m.id, 'clinician_name', c.name, 'clinician_first_name', split_part(c.name, ' ', 1),
                         'child_first_name', v_child.first_name, 'calcom_intro_url', c.calcom_intro_url));
    perform private.notify_staff('offer_accepted',
      jsonb_build_object('family_id', m.family_id, 'clinician_name', c.name, 'child_first_name', v_child.first_name));
  else
    update public.matches set state = 'declined', responded_at = now(), response_reason = p_reason where id = m.id;
    perform private.advance_offers(m.child_id);
  end if;
end $$;

-- Staff can pull an offer (e.g. the family withdrew, or the wrong clinician was chosen).
create or replace function public.withdraw_offer(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
begin
  perform private.require_staff();
  select * into m from public.matches where id = p_match for update;
  if m.state not in ('proposed', 'offered') then
    raise exception 'Only open offers can be withdrawn' using errcode = 'P0001';
  end if;
  update public.matches set state = 'withdrawn', response_reason = p_reason where id = m.id;
  if m.state = 'offered' then
    perform private.notify_clinician('offer_withdrawn', m.clinician_id, '{}');
  end if;
  perform private.advance_offers(m.child_id);
end $$;

-- Timeouts and the 24-hour nudge. Runs every few minutes.
create or replace function private.run_offer_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m record;
  v_timeouts integer := 0;
  v_nudges integer := 0;
  v_nudge_hours integer := coalesce(private.setting_int('offer_nudge_hours'), 24);
begin
  for m in
    select id, child_id from public.matches
     where state = 'offered' and offer_expires_at < now()
     for update skip locked
  loop
    update public.matches set state = 'timeout', responded_at = now() where id = m.id;
    perform private.advance_offers(m.child_id);
    v_timeouts := v_timeouts + 1;
  end loop;

  for m in
    select id, clinician_id, offer_expires_at from public.matches
     where state = 'offered' and nudged_at is null and offered_at < now() - make_interval(hours => v_nudge_hours)
     for update skip locked
  loop
    update public.matches set nudged_at = now() where id = m.id;
    perform private.notify_clinician('offer_nudge', m.clinician_id,
      jsonb_build_object('match_id', m.id, 'offer_expires_at', m.offer_expires_at),
      array['sms']::public.message_channel[]);
    v_nudges := v_nudges + 1;
  end loop;

  return jsonb_build_object('timeouts', v_timeouts, 'nudges', v_nudges);
end $$;

-- Clinician (or staff) records how the free intro call went.
create or replace function public.record_intro_outcome(p_match uuid, p_outcome public.intro_outcome, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  f public.families;
  v_token text;
  v_intro uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not (private.is_staff() or m.clinician_id = private.current_clinician_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if m.state <> 'accepted' then
    raise exception 'This referral is no longer active' using errcode = 'P0001';
  end if;
  if p_outcome = 'not_going_ahead' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Please add a short reason' using errcode = 'P0001';
  end if;
  select * into f from public.families where id = m.family_id for update;

  select id into v_intro from public.intro_calls where match_id = m.id and outcome is null order by created_at desc limit 1;
  if v_intro is null then
    insert into public.intro_calls (match_id, outcome, reason, recorded_at) values (m.id, p_outcome, p_reason, now());
  else
    update public.intro_calls set outcome = p_outcome, reason = p_reason, recorded_at = now() where id = v_intro;
  end if;

  if p_outcome = 'going_ahead' then
    perform private.set_family_status(f.id, 'intro_done', null);
    v_token := private.new_token();
    insert into public.action_tokens (token_hash, purpose, match_id, expires_at)
    values (private.hash_token(v_token), 'first_session', m.id, now() + interval '30 days');
    perform private.notify_clinician('first_session_check', m.clinician_id,
      jsonb_build_object('match_id', m.id, 'token', v_token), array['email']::public.message_channel[],
      now() + interval '3 days');
  else
    update public.matches set state = 'withdrawn', response_reason = 'Intro call: not going ahead. ' || p_reason
     where id = m.id;
    update public.clinicians set capacity_new = capacity_new + 1 where id = m.clinician_id;
    perform private.set_family_status(f.id, 'ready_to_match', 'Intro call: not going ahead. ' || p_reason);
    perform private.notify_staff('intro_not_going_ahead',
      jsonb_build_object('family_id', f.id, 'reason', p_reason));
  end if;
end $$;

create or replace function private.confirm_first_session_core(p_match uuid, p_date date, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.state <> 'accepted' then
    raise exception 'This referral is no longer active' using errcode = 'P0001';
  end if;
  if p_date is null or p_date < private.today() - 60 or p_date > private.today() + 120 then
    raise exception 'Enter the date of the first session' using errcode = 'P0001';
  end if;
  insert into public.conversions (match_id, first_session_at, confirmed_by) values (m.id, p_date, p_by)
  on conflict (match_id) do update set first_session_at = excluded.first_session_at, confirmed_by = excluded.confirmed_by;
  perform private.set_family_status(m.family_id, 'converted', null);
  update public.action_tokens set used_at = now() where match_id = m.id and used_at is null;

  -- automatic follow-ups
  perform private.notify_family('satisfaction_check', m.family_id, jsonb_build_object('match_id', m.id),
    array['sms', 'email']::public.message_channel[],
    p_date::timestamp at time zone 'Australia/Sydney' + make_interval(days => coalesce(private.setting_int('family_followup_days'), 14), hours => 10));
  perform private.notify_clinician('clinician_checkin', m.clinician_id, jsonb_build_object('match_id', m.id),
    array['email']::public.message_channel[],
    p_date::timestamp at time zone 'Australia/Sydney' + make_interval(days => coalesce(private.setting_int('clinician_checkin_days'), 42), hours => 10));
end $$;

create or replace function public.confirm_first_session(p_match uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select clinician_id into v_owner from public.matches where id = p_match;
  if not (private.is_staff() or v_owner = private.current_clinician_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.confirm_first_session_core(p_match, p_date, auth.uid());
end $$;

-- One-click link from the "Did the first session get booked?" email. Server-side only.
create or replace function public.confirm_first_session_by_token(p_token text, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.action_tokens;
begin
  select * into t from public.action_tokens
   where token_hash = private.hash_token(p_token) and purpose = 'first_session' for update;
  if not found or t.used_at is not null or t.expires_at < now() then
    raise exception 'This link has expired or has already been used' using errcode = 'P0001';
  end if;
  perform private.confirm_first_session_core(t.match_id, p_date, null);
  return t.match_id;
end $$;

create or replace function public.peek_action_token(p_token text) returns table (match_id uuid, valid boolean)
language sql stable security definer set search_path = '' as $$
  select t.match_id, (t.used_at is null and t.expires_at > now())
    from public.action_tokens t where t.token_hash = private.hash_token(p_token)
$$;

-- ---------------------------------------------------------------------------
-- What a clinician sees before accepting: no names, contact details or address.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_offers()
returns table (
  match_id uuid, state public.match_state, offered_at timestamptz, offer_expires_at timestamptz,
  responded_at timestamptz, child_age_years integer, suburb text, distance_km numeric,
  concerns text[], concern_other text, service_type public.service_type, funding_type public.funding_type,
  preferred_times public.time_block[], language text, telehealth_ok boolean, interests_needed text[]
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.state, m.offered_at, m.offer_expires_at, m.responded_at,
         private.age_years(ch.dob, ch.age_years), f.suburb, round(m.distance_km),
         ch.concerns, ch.concern_other, ch.service_type, f.funding_type,
         ch.preferred_times, ch.language, ch.telehealth_ok, ch.interests_needed
    from public.matches m
    join public.children ch on ch.id = m.child_id
    join public.families f on f.id = m.family_id
   where m.clinician_id = private.current_clinician_id()
     and m.offered_at is not null
   order by m.offered_at desc
$$;

-- ---------------------------------------------------------------------------
-- Family intake
-- ---------------------------------------------------------------------------

create or replace function public.complete_intake(p_family uuid, p_outcome public.intake_outcome,
  p_answers jsonb, p_notes text default null, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
  v_call uuid;
begin
  perform private.require_staff();
  select * into f from public.families where id = p_family for update;
  if not found then
    raise exception 'Family not found';
  end if;
  if f.status not in ('new', 'contacted', 'intake_booked', 'intake_done') then
    raise exception 'The intake for this family is already complete' using errcode = 'P0001';
  end if;
  if p_outcome = 'not_suitable' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason and the signposting advice for the family' using errcode = 'P0001';
  end if;

  select id into v_call from public.intake_calls
   where family_id = p_family and completed_at is null order by created_at desc limit 1;
  if v_call is null then
    insert into public.intake_calls (family_id, coordinator_id, completed_at, outcome, outcome_reason, answers, notes)
    values (p_family, auth.uid(), now(), p_outcome, p_reason, coalesce(p_answers, '{}'), p_notes);
  else
    update public.intake_calls
       set coordinator_id = auth.uid(), completed_at = now(), outcome = p_outcome, outcome_reason = p_reason,
           answers = coalesce(p_answers, '{}'), notes = p_notes
     where id = v_call;
  end if;

  if f.status in ('new', 'contacted', 'intake_booked') then
    perform private.set_family_status(p_family, 'intake_done', null);
  end if;
  if p_outcome = 'ready_to_match' then
    perform private.set_family_status(p_family, 'ready_to_match', null);
  elsif p_outcome = 'not_suitable' then
    perform public.set_family_status(p_family, 'not_suitable', p_reason);
  else
    perform private.set_family_status(p_family, 'contacted', coalesce(p_reason, 'Intake needs follow-up'));
  end if;
end $$;

create or replace function public.set_waitlist(p_family uuid, p_reason text, p_codes text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.families set status = 'waitlist' where id = p_family;
  update public.families set waitlist_reason = p_reason, waitlist_codes = coalesce(p_codes, '{}') where id = p_family;
  perform set_config('app.status_reason', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Public forms and webhooks (called by the server with the service role only)
-- ---------------------------------------------------------------------------

create or replace function public.submit_enquiry(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_family uuid;
  v_child uuid;
  v_version text := coalesce(p ->> 'consent_version', private.setting_text('consent_version'));
begin
  if not coalesce((p ->> 'consent_privacy')::boolean, false)
     or not coalesce((p ->> 'consent_contact')::boolean, false)
     or not coalesce((p ->> 'consent_share')::boolean, false) then
    raise exception 'Consent is required' using errcode = 'P0001';
  end if;

  insert into public.families (parent_name, email, mobile, suburb, postcode, state, lat, lng,
                               funding_type, referral_source)
  values (btrim(p ->> 'parent_name'), lower(btrim(p ->> 'email')), p ->> 'mobile', btrim(p ->> 'suburb'),
          p ->> 'postcode', nullif(p ->> 'state', ''), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          (p ->> 'funding_type')::public.funding_type, nullif(btrim(p ->> 'referral_source'), ''))
  returning id into v_family;

  insert into public.children (family_id, first_name, dob, age_years, concerns, concern_other, service_type, preferred_times)
  values (v_family, btrim(p ->> 'child_first_name'), nullif(p ->> 'dob', '')::date, nullif(p ->> 'age_years', '')::smallint,
          coalesce(array(select jsonb_array_elements_text(p -> 'concerns')), '{}'),
          nullif(btrim(p ->> 'concern_other'), ''),
          (p ->> 'service_type')::public.service_type,
          coalesce(array(select jsonb_array_elements_text(p -> 'preferred_times'))::public.time_block[], '{}'))
  returning id into v_child;

  insert into public.consents (family_id, type, version)
  values (v_family, 'privacy_collection', v_version),
         (v_family, 'contact', v_version),
         (v_family, 'share_with_clinician', v_version);

  perform private.notify_family('enquiry_received', v_family,
    jsonb_build_object('child_first_name', btrim(p ->> 'child_first_name')));
  perform private.notify_staff('new_enquiry',
    jsonb_build_object('family_id', v_family, 'suburb', btrim(p ->> 'suburb'), 'funding_type', p ->> 'funding_type',
                       'service_type', p ->> 'service_type', 'geocoded', (p ->> 'lat') is not null));
  return v_family;
end $$;

create or replace function public.submit_application(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.clinicians where lower(email) = lower(btrim(p ->> 'email'))) then
    raise exception 'We already have an application from this email address' using errcode = '23505';
  end if;
  insert into public.clinicians (name, email, mobile, profession, experience_years, suburb, postcode,
                                 base_lat, base_lng, interests, ndis_registered, abn, application)
  values (btrim(p ->> 'name'), lower(btrim(p ->> 'email')), p ->> 'mobile', (p ->> 'profession')::public.profession,
          (p ->> 'experience_years')::smallint, btrim(p ->> 'suburb'), p ->> 'postcode',
          (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          coalesce(array(select jsonb_array_elements_text(p -> 'interests')), '{}'),
          false, nullif(p ->> 'abn', ''),
          jsonb_build_object('suburbs', p ->> 'suburbs', 'availability', p ->> 'availability',
                             'ndis_registration_status', p ->> 'ndis_registration_status',
                             'referral_source', p ->> 'referral_source', 'submitted_at', now()))
  returning id into v_id;
  perform private.notify_clinician('application_received', v_id, '{}');
  perform private.notify_staff('new_application',
    jsonb_build_object('clinician_id', v_id, 'clinician_name', btrim(p ->> 'name'), 'profession', p ->> 'profession'));
  return v_id;
end $$;

-- Cal.com booking webhooks. p_kind: intake | intro | screening
create or replace function public.record_booking(p_kind text, p_ref uuid, p_email text, p_start timestamptz,
  p_uid text, p_cancelled boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
  m public.matches;
  c public.clinicians;
begin
  if p_kind = 'intake' then
    select * into f from public.families
     where (id = p_ref or (p_ref is null and lower(email) = lower(p_email)))
       and status in ('new', 'contacted', 'intake_booked')
     order by created_at desc limit 1 for update;
    if not found then
      return 'no matching family';
    end if;
    if p_cancelled then
      update public.intake_calls set scheduled_at = null where calcom_booking_uid = p_uid;
      if f.status = 'intake_booked' then
        perform private.set_family_status(f.id, 'contacted', 'Intake call cancelled');
      end if;
      return 'intake cancelled';
    end if;
    insert into public.intake_calls (family_id, scheduled_at, calcom_booking_uid)
    values (f.id, p_start, p_uid)
    on conflict (calcom_booking_uid) do update set scheduled_at = excluded.scheduled_at;
    perform private.set_family_status(f.id, 'intake_booked', null);
    -- reminders: 24h and 1h before
    if p_start - interval '24 hours' > now() then
      perform private.notify_family('intake_reminder', f.id, jsonb_build_object('starts_at', p_start),
        array['sms']::public.message_channel[], p_start - interval '24 hours');
    end if;
    if p_start - interval '1 hour' > now() then
      perform private.notify_family('intake_reminder', f.id, jsonb_build_object('starts_at', p_start),
        array['sms']::public.message_channel[], p_start - interval '1 hour');
    end if;
    return 'intake booked';

  elsif p_kind = 'intro' then
    select mt.* into m from public.matches mt join public.families fam on fam.id = mt.family_id
     where mt.state = 'accepted' and (mt.id = p_ref or (p_ref is null and lower(fam.email) = lower(p_email)))
     order by mt.responded_at desc limit 1;
    if not found then
      return 'no matching referral';
    end if;
    select * into f from public.families where id = m.family_id for update;
    if p_cancelled then
      update public.intro_calls set scheduled_at = null where calcom_booking_uid = p_uid;
      if f.status = 'intro_booked' then
        perform private.set_family_status(f.id, 'accepted', 'Intro call cancelled');
      end if;
      return 'intro cancelled';
    end if;
    insert into public.intro_calls (match_id, scheduled_at, calcom_booking_uid)
    values (m.id, p_start, p_uid)
    on conflict (calcom_booking_uid) do update set scheduled_at = excluded.scheduled_at;
    if f.status = 'accepted' then
      perform private.set_family_status(f.id, 'intro_booked', null);
    end if;
    if p_start - interval '24 hours' > now() then
      perform private.notify_family('intro_reminder', m.family_id, jsonb_build_object('starts_at', p_start),
        array['sms']::public.message_channel[], p_start - interval '24 hours');
      perform private.notify_clinician('intro_reminder_clinician', m.clinician_id,
        jsonb_build_object('starts_at', p_start, 'match_id', m.id), array['sms']::public.message_channel[],
        p_start - interval '24 hours');
    end if;
    return 'intro booked';

  elsif p_kind = 'screening' then
    select * into c from public.clinicians
     where id = p_ref or (p_ref is null and lower(email) = lower(p_email)) limit 1;
    if not found then
      return 'no matching applicant';
    end if;
    update public.clinicians
       set application = application || jsonb_build_object('screening_at', case when p_cancelled then null else p_start end)
     where id = c.id;
    if c.status = 'applied' and not p_cancelled then
      perform set_config('app.status_reason', 'Screening call booked', true);
      update public.clinicians set status = 'screening' where id = c.id;
      perform set_config('app.status_reason', '', true);
    end if;
    return 'screening ' || case when p_cancelled then 'cancelled' else 'booked' end;
  end if;
  raise exception 'Unknown booking kind %', p_kind;
end $$;

-- Documenso webhook: the clinician service agreement was signed.
create or replace function public.record_agreement_signed(p_ref text, p_signed_at timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.agreements;
  c public.clinicians;
begin
  update public.agreements set signed_at = coalesce(signed_at, p_signed_at)
   where documenso_ref = p_ref returning * into a;
  if not found then
    return 'no matching agreement';
  end if;
  select * into c from public.clinicians where id = a.clinician_id;
  if c.status in ('documents_requested', 'documents_verified') then
    perform set_config('app.status_reason', 'Agreement signed (v' || a.version || ')', true);
    update public.clinicians set status = 'agreement_signed' where id = c.id;
    perform set_config('app.status_reason', '', true);
  end if;
  return 'agreement signed';
end $$;

create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count <= p_max;
end $$;

create or replace function public.set_my_preferences(p_show_uk_time boolean) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set show_uk_time = p_show_uk_time where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Daily job: credential expiry, reminders, re-credentialing, snooze ends
-- ---------------------------------------------------------------------------

create or replace function private.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today();
  v_days integer[] := coalesce(array(select jsonb_array_elements_text(private.setting('credential_reminder_days'))::integer order by 1), '{60,30,7}');
  v_staff_days integer := coalesce(private.setting_int('staff_alert_days'), 7);
  v_recred integer := coalesce(private.setting_int('recredential_months'), 12);
  r record;
  v_band integer;
  v_expired integer := 0;
  v_reminders integer := 0;
  v_prompts integer := 0;
  v_waitlisted integer;
begin
  -- 1. Expire credentials whose date has passed; pause if a required one lapsed.
  for r in
    update public.credentials set status = 'expired'
     where status = 'verified' and expires_at < v_today
    returning clinician_id, type
  loop
    v_expired := v_expired + 1;
    if r.type = 'ndis_registration' then
      update public.clinicians set ndis_registered = false where id = r.clinician_id;
    end if;
    perform private.pause_for_credentials(r.clinician_id, 'Credential expired: ' || r.type::text);
    perform private.notify_staff('credential_expired_staff',
      jsonb_build_object('clinician_id', r.clinician_id,
                         'clinician_name', (select name from public.clinicians where id = r.clinician_id),
                         'credential_type', r.type));
  end loop;

  -- 1b. Safety net: any Active clinician with a gap in required documents (for whatever reason,
  --     e.g. they started doing home visits without a sighted licence) is paused too.
  for r in
    select c.id from public.clinicians c
     where c.status = 'active'
       and cardinality(private.credential_gaps(c.id, c.profession, c.home_visits)) > 0
  loop
    perform private.pause_for_credentials(r.id, 'Required documents missing');
  end loop;

  -- 2. Reminders at 60 / 30 / 7 days (only the nearest band, once each).
  for r in
    select cr.id, cr.clinician_id, cr.type, cr.expires_at, (cr.expires_at - v_today) as days_left
      from public.credentials cr join public.clinicians c on c.id = cr.clinician_id
     where cr.status = 'verified' and cr.expires_at is not null
       and cr.expires_at - v_today between 0 and v_days[array_upper(v_days, 1)]
       and c.status not in ('offboarded')
       and not exists (select 1 from public.credentials nx
                        where nx.clinician_id = cr.clinician_id and nx.type = cr.type and nx.status = 'pending')
  loop
    select min(d) into v_band from unnest(v_days) d where r.days_left <= d;
    if exists (select 1 from public.credential_reminders cm where cm.credential_id = r.id and cm.days_before <= v_band) then
      continue;
    end if;
    insert into public.credential_reminders (credential_id, days_before) values (r.id, v_band);
    perform private.notify_clinician('credential_expiring', r.clinician_id,
      jsonb_build_object('credential_type', r.type, 'expires_at', r.expires_at, 'days_left', r.days_left),
      array['email', 'sms']::public.message_channel[]);
    if v_band <= v_staff_days then
      perform private.notify_staff('credential_expiring_staff',
        jsonb_build_object('clinician_id', r.clinician_id,
                           'clinician_name', (select name from public.clinicians where id = r.clinician_id),
                           'credential_type', r.type, 'expires_at', r.expires_at));
    end if;
    v_reminders := v_reminders + 1;
  end loop;

  -- 3. Annual re-credentialing prompt.
  for r in
    select c.id from public.clinicians c
     where c.status in ('active', 'paused')
       and coalesce(c.last_recredentialed_at, c.clinical_lead_approved_at, c.created_at) < now() - make_interval(months => v_recred)
       and not exists (select 1 from public.message_log ml
                        where ml.recipient_kind = 'clinician' and ml.recipient_id = c.id
                          and ml.template = 'recredential_prompt' and ml.created_at > now() - interval '30 days')
  loop
    perform private.notify_clinician('recredential_prompt', r.id, '{}');
    v_prompts := v_prompts + 1;
  end loop;

  -- 4. Snoozes that ended yesterday free up capacity: re-check the waitlist.
  select count(*) into v_waitlisted from public.families where status = 'waitlist';
  if v_waitlisted > 0 then
    for r in
      select id, name from public.clinicians
       where status = 'active' and snoozed_until = v_today - 1 and capacity_new > 0
    loop
      perform private.notify_staff('waitlist_recheck',
        jsonb_build_object('clinician_id', r.id, 'clinician_name', r.name, 'waitlist_count', v_waitlisted));
    end loop;
  end if;

  return jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'recredential_prompts', v_prompts);
end $$;

-- Families who didn't go ahead are anonymised after the retention period.
-- Not scheduled by default: the period must be confirmed with the privacy lawyer first.
create or replace function private.anonymise_stale_families() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_months integer := coalesce(private.setting_int('retention_months'), 12);
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from public.families
   where status in ('lost', 'not_suitable', 'withdrawn')
     and status_changed_at < now() - make_interval(months => v_months)
     and anonymised_at is null;
  update public.families
     set parent_name = 'Anonymised', email = 'anonymised+' || id || '@invalid.example', mobile = '+61400000000',
         lat = null, lng = null, plan_manager = null, anonymised_at = now()
   where id = any (v_ids);
  update public.children
     set first_name = 'Anonymised', dob = null,
         age_years = coalesce(age_years, private.age_years(dob, age_years)::smallint),
         notes_intake = null, concern_other = null, language = null
   where family_id = any (v_ids);
  update public.intake_calls set notes = null, answers = '{}' where family_id = any (v_ids);
  update public.message_log set recipient = 'anonymised', payload = '{}'
   where recipient_kind = 'family' and recipient_id = any (v_ids);
  return cardinality(v_ids);
end $$;

create or replace function public.run_scheduled_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_service() or private.is_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return case p_job
    when 'daily' then private.run_daily_jobs()
    when 'offers' then private.run_offer_jobs()
    when 'retention' then jsonb_build_object('anonymised', private.anonymise_stale_families())
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard view (runs with the caller's permissions, so RLS still applies)
-- ---------------------------------------------------------------------------

create or replace view public.family_pipeline with (security_invoker = true) as
select f.id, f.parent_name, f.suburb, f.postcode, f.funding_type, f.status, f.status_reason,
       f.status_changed_at, f.complex_case, f.assigned_to, f.referral_source, f.created_at,
       f.waitlist_reason, f.lat is not null as geocoded,
       (select string_agg(c.first_name, ', ' order by c.created_at) from public.children c where c.family_id = f.id) as child_names,
       round((extract(epoch from now() - f.status_changed_at) / 3600)::numeric, 1) as hours_in_status,
       (private.setting('stale_limits_hours') ->> f.status::text)::numeric as stale_limit_hours,
       coalesce(extract(epoch from now() - f.status_changed_at) / 3600
                > (private.setting('stale_limits_hours') ->> f.status::text)::numeric, false) as is_stale
  from public.families f
 where f.anonymised_at is null;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger families_touch before update on public.families for each row execute function private.touch_updated_at();
create trigger children_touch before update on public.children for each row execute function private.touch_updated_at();
create trigger intake_calls_touch before update on public.intake_calls for each row execute function private.touch_updated_at();
create trigger clinicians_touch before update on public.clinicians for each row execute function private.touch_updated_at();
create trigger credentials_touch before update on public.credentials for each row execute function private.touch_updated_at();
create trigger matches_touch before update on public.matches for each row execute function private.touch_updated_at();
create trigger fee_statements_touch before update on public.fee_statements for each row execute function private.touch_updated_at();
create trigger offboarding_touch before update on public.offboarding_checklists for each row execute function private.touch_updated_at();

create trigger families_status_guard before update of status on public.families
  for each row execute function private.family_status_guard();
create trigger families_status_history after insert or update of status on public.families
  for each row execute function private.family_status_history();

create trigger clinicians_self_edit_guard before update on public.clinicians
  for each row execute function private.clinician_self_edit_guard();
create trigger clinicians_status_guard before update of status on public.clinicians
  for each row execute function private.clinician_status_guard();
create trigger clinicians_after_change after insert or update on public.clinicians
  for each row execute function private.clinician_after_change();

create trigger credentials_insert_guard before insert on public.credentials
  for each row execute function private.credential_insert_guard();

-- audit every change to family, clinician and credential data
create trigger audit_families after insert or update or delete on public.families for each row execute function private.audit_row();
create trigger audit_children after insert or update or delete on public.children for each row execute function private.audit_row();
create trigger audit_consents after insert or update or delete on public.consents for each row execute function private.audit_row();
create trigger audit_intake_calls after insert or update or delete on public.intake_calls for each row execute function private.audit_row();
create trigger audit_clinicians after insert or update or delete on public.clinicians for each row execute function private.audit_row();
create trigger audit_credentials after insert or update or delete on public.credentials for each row execute function private.audit_row();
create trigger audit_matches after insert or update or delete on public.matches for each row execute function private.audit_row();
create trigger audit_agreements after insert or update or delete on public.agreements for each row execute function private.audit_row();
create trigger audit_fee_statements after insert or update or delete on public.fee_statements for each row execute function private.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Outbox: the app claims due messages, sends them, then reports back.
-- ---------------------------------------------------------------------------

create or replace function public.claim_messages(p_limit integer default 50) returns setof public.message_log
language sql security definer set search_path = '' as $$
  update public.message_log ml
     set status = 'sending', attempts = ml.attempts + 1
   where ml.id in (
     select id from public.message_log
      where (status = 'queued' and scheduled_for <= now())
         or (status = 'sending' and scheduled_for <= now() - interval '10 minutes')  -- a crashed send
      order by scheduled_for
      limit p_limit
      for update skip locked)
  returning ml.*
$$;

create or replace function public.complete_message(p_id uuid, p_status public.message_status,
  p_error text default null, p_provider_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_attempts smallint;
begin
  select attempts into v_attempts from public.message_log where id = p_id;
  if p_status = 'failed' and v_attempts < 5 then
    -- retry with backoff: 2, 4, 8, 16 minutes
    update public.message_log
       set status = 'queued', last_error = p_error, scheduled_for = now() + make_interval(mins => power(2, v_attempts)::integer)
     where id = p_id;
  else
    update public.message_log
       set status = p_status, last_error = p_error, provider_ref = p_provider_ref,
           sent_at = case when p_status = 'sent' then now() end
     where id = p_id;
  end if;
end $$;
