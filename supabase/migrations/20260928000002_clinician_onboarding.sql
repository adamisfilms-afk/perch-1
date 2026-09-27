-- Clinician sign-up flow and the clinician summary page.
--
--   1. The /join form creates the clinician; the app then creates their portal login and
--      link_clinician_portal() emails them a welcome with a link to set their password.
--   2. In the portal they complete their profile, upload their documents, accept the service
--      agreement and submit (submit_my_application). They're emailed a link to book an intake call.
--   3. Booking the call (Cal.com) moves them to "screening" (shown as Intake call booked).
--   4. A clinical lead or admin records the intake call (complete_clinician_intake): that approves
--      them and makes them active ("Ready") once the go-live gate passes (verified documents etc.).
--   5. On the summary page, an active clinician with a client whose first session is confirmed is "Active".
--
-- Area matching is gone, so the go-live gate no longer asks for a service area.

alter table public.clinicians
  add column application_submitted_at timestamptz,
  add column intake_completed_at timestamptz;

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
       or new.application is distinct from old.application
       or new.application_submitted_at is distinct from old.application_submitted_at
       or new.intake_completed_at is distinct from old.intake_completed_at then
      raise exception 'Please ask the team to change that for you' using errcode = '42501';
    end if;
    -- agency-managed NDIS funding needs verified NDIS registration
    if 'ndis_agency_managed' = any (new.funding_types) and not new.ndis_registered then
      raise exception 'Agency-managed NDIS families can only be seen by NDIS-registered clinicians' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function private.clinician_transition_allowed(p_from public.clinician_status, p_to public.clinician_status)
returns boolean
language sql immutable set search_path = '' as $$
  select p_to = 'offboarded' and p_from <> 'offboarded' or case p_from
    when 'applied'             then p_to in ('screening', 'documents_requested', 'active')
    when 'screening'           then p_to in ('documents_requested', 'applied', 'active')
    when 'documents_requested' then p_to in ('documents_verified', 'agreement_signed', 'active')
    when 'documents_verified'  then p_to in ('agreement_signed', 'documents_requested', 'onboarding', 'active')
    when 'agreement_signed'    then p_to in ('documents_verified', 'onboarding', 'orientation', 'active')
    when 'onboarding'          then p_to in ('orientation', 'active')
    when 'orientation'         then p_to in ('active', 'onboarding')
    when 'active'              then p_to in ('paused')
    when 'paused'              then p_to in ('active')
    else false
  end
$$;

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

-- The welcome email (with the portal link) replaces the old "application received" email.
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
  perform private.notify_staff('new_application',
    jsonb_build_object('clinician_id', v_id, 'clinician_name', btrim(p ->> 'name'), 'profession', p ->> 'profession'));
  return v_id;
end $$;

-- Server only: link the new portal login to the clinician and email them the welcome.
-- p_link_type is 'invite' for a new login, or 'recovery' when resending to an existing one.
create or replace function public.link_clinician_portal(p_clinician uuid, p_user uuid, p_token_hash text, p_link_type text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  select * into c from public.clinicians where id = p_clinician for update;
  if not found then
    raise exception 'Clinician not found' using errcode = 'P0001';
  end if;
  if c.user_id is null then
    insert into public.profiles (id, role, full_name, email) values (p_user, 'clinician', c.name, c.email)
    on conflict (id) do nothing;
    update public.clinicians set user_id = p_user where id = c.id;
  elsif c.user_id <> p_user then
    raise exception 'This clinician is linked to a different login' using errcode = 'P0001';
  end if;
  perform private.notify_clinician('clinician_welcome', c.id,
    jsonb_build_object('portal_token_hash', p_token_hash, 'portal_link_type', p_link_type));
end $$;

-- What's still missing before a clinician can submit their application. Empty = ready to submit.
-- Documents only need to be uploaded here (the team verifies them before the clinician goes live).
-- A driver's licence and car insurance are sighted by the team rather than uploaded, so they're left to the go-live gate.
create or replace function private.application_gaps(c public.clinicians) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  gaps text[] := '{}';
begin
  gaps := gaps || array(
    select 'document:' || t::text
      from unnest(private.required_credential_types(c.profession, c.home_visits)) t
     where t not in ('drivers_licence', 'car_insurance')
       and not exists (select 1 from public.credentials cr
                        where cr.clinician_id = c.id and cr.type = t and cr.status in ('pending', 'verified')
                          and (cr.expires_at is null or cr.expires_at >= private.today()))
     order by t::text);
  if c.mobile is null then
    gaps := gaps || 'mobile'::text;
  end if;
  if c.calcom_intro_url is null then
    gaps := gaps || 'calcom_intro_url'::text;
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

create or replace function public.clinician_application_gaps(p_clinician uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  if not (private.is_staff() or private.current_clinician_id() = p_clinician) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician;
  return private.application_gaps(c);
end $$;

-- The clinician submits their application from the portal, accepting the service agreement.
create or replace function public.submit_my_application(p_agreement_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  v_gaps text[];
begin
  select * into c from public.clinicians where id = private.current_clinician_id() for update;
  if not found then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if c.application_submitted_at is not null then
    raise exception 'Your application has already been submitted' using errcode = 'P0001';
  end if;
  v_gaps := private.application_gaps(c);
  if cardinality(v_gaps) > 0 then
    raise exception 'Your application isn''t complete yet: %', array_to_string(v_gaps, ', ') using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_agreement_version), '') = '' then
    raise exception 'Please accept the service agreement' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.agreements where clinician_id = c.id and signed_at is not null) then
    insert into public.agreements (clinician_id, version, sent_at, signed_at) values (c.id, p_agreement_version, now(), now());
  end if;
  update public.clinicians set application_submitted_at = now() where id = c.id;

  perform private.notify_clinician('application_submitted', c.id, '{}');
  perform private.notify_staff('application_submitted_staff',
    jsonb_build_object('clinician_id', c.id, 'clinician_name', c.name, 'profession', c.profession));
end $$;

-- A clinical lead or admin records the intake call. This is their approval, and makes the clinician
-- active (Ready for clients) if the go-live gate passes; otherwise nothing changes and the gaps are listed.
create or replace function public.complete_clinician_intake(p_clinician uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  v_gaps text[];
begin
  if not private.can_approve_complex() then
    raise exception 'Only a clinical lead or admin can record the intake call' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician for update;
  if not found then
    raise exception 'Clinician not found' using errcode = 'P0001';
  end if;
  if c.status in ('active', 'paused', 'offboarded') then
    raise exception 'This clinician has already finished onboarding' using errcode = 'P0001';
  end if;
  if c.application_submitted_at is null then
    raise exception 'The clinician hasn''t submitted their application yet' using errcode = 'P0001';
  end if;

  c.clinical_lead_approved_at := coalesce(c.clinical_lead_approved_at, now());
  v_gaps := private.go_live_gaps(c);
  if cardinality(v_gaps) > 0 then
    raise exception 'Not ready to go live: %', array_to_string(v_gaps, ', ') using errcode = 'P0001';
  end if;

  update public.clinicians
     set clinical_lead_approved_by = coalesce(clinical_lead_approved_by, auth.uid()),
         clinical_lead_approved_at = coalesce(clinical_lead_approved_at, now()),
         intake_completed_at = now(),
         screening_notes = coalesce(nullif(btrim(p_notes), ''), screening_notes)
   where id = c.id;
  perform set_config('app.status_reason', 'Intake call complete', true);
  update public.clinicians set status = 'active' where id = c.id;
  perform set_config('app.status_reason', '', true);
  perform private.notify_clinician('clinician_ready', c.id, '{}');
end $$;

revoke execute on function
  public.link_clinician_portal(uuid, uuid, text, text),
  public.clinician_application_gaps(uuid),
  public.submit_my_application(text),
  public.complete_clinician_intake(uuid, text)
from public, anon;
revoke execute on function public.link_clinician_portal(uuid, uuid, text, text) from authenticated;
grant execute on function public.link_clinician_portal(uuid, uuid, text, text) to service_role;
grant execute on function
  public.clinician_application_gaps(uuid),
  public.submit_my_application(text),
  public.complete_clinician_intake(uuid, text)
to authenticated;
grant execute on function private.application_gaps(public.clinicians) to authenticated, service_role;

insert into public.settings (key, value, description) values
  ('clinician_kpi_targets',
   '{"total_clinicians": 30, "active_rate_pct": 50, "signup_to_session_days": 21, "new_signups_7d": 3}',
   'Targets for the clinician summary: total clinicians, % with an active client, average days from sign-up to their first client session, and new sign-ups per 7 days'),
  ('clinician_step_targets_hours',
   '{"new": 168, "application_complete": 72, "intake_booked": 168}',
   'Hours a clinician can wait in each onboarding step on the clinician summary before it shows in red')
on conflict (key) do nothing;

insert into public.message_templates (key, channel, subject, body, description) values
('clinician_welcome', 'email', 'Welcome to Perch: set up your account',
'Hi {{clinician_first_name}},

Thanks for signing up to join our clinician network.

Set your password here to open your portal: {{portal_invite_url}}

In the portal, please:
1. complete your profile (the ages and funding types you work with, your available times, and your Cal.com intro-call link),
2. upload your documents (registration, Working with Children Check, NDIS screening, insurance and ABN),
3. accept the service agreement and submit your application.

Once it''s submitted, we''ll send you a link to book a short intake call.

If the link has expired, request a new one at {{app_url}}/forgot.

The Switchboard team', 'Clinician: welcome after signing up, with a link to set their password'),

('application_submitted', 'email', 'Application received: book your intake call',
'Hi {{clinician_first_name}},

Thanks for submitting your application. The next step is a short intake call with our team.

Book a time that suits you: {{screening_booking_url}}

We''ll check your documents before the call.

The Switchboard team', 'Clinician: application submitted, with the intake-call booking link'),

('application_submitted_staff', 'email', 'Application submitted: {{clinician_name}}',
'{{clinician_name}} ({{profession_label}}) has submitted their application. Check their documents before the intake call: {{app_url}}/clinicians/{{clinician_id}}',
'Staff: a clinician submitted their application'),

('application_submitted_staff', 'slack', null,
':inbox_tray: {{clinician_name}} ({{profession_label}}) submitted their application. {{app_url}}/clinicians/{{clinician_id}}',
'Staff: a clinician submitted their application'),

('clinician_ready', 'email', 'You''re ready for referrals',
'Hi {{clinician_first_name}},

Thanks for your time on the intake call. You''re now set up to receive clients through Perch.

When we match you with a family, we''ll email you and send them your intro-call link. Keep your capacity and availability up to date in the portal: {{portal_url}}/profile

The Switchboard team', 'Clinician: intake call recorded, ready for clients')
on conflict (key, channel) do nothing;
