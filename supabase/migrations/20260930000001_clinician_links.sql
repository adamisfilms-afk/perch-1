-- No clinician portal: clinicians use private links instead of logging in.
--
--   * Their page (/clinician/<signed link>): profile, intro-call hours and days off, documents, the service
--     agreement and application, and their intake call. It never shows family details. The link is versioned
--     (clinicians.link_version): staff can reset it, which stops the old one working.
--   * Referrals: allocating a clinician now OFFERS them the client. They get an email (and a text) with a
--     de-identified summary and a link to accept or decline (/referral/<signed link>). On accept, the family is
--     emailed their intro-call booking link and the clinician is emailed the family's details. On decline, or if
--     they don't answer in time, the family goes back to Ready to match and staff are told (email and Slack).
--     The same referral link is where the clinician later records the intro call and the first session.
--   * The app checks each signed link and calls the functions below with the service role.

alter table public.clinicians rename column availability_link_version to link_version;

-- Clinician messages carry their link version, so emails can include their page and referral links.
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
                                  'clinician_first_name', split_part(c.name, ' ', 1),
                                  'link_version', c.link_version) || coalesce(p_payload, '{}');
  if 'email' = any (p_channels) then
    perform private.enqueue(p_template, 'email', c.email, 'clinician', c.id, p_payload, p_at);
  end if;
  if 'sms' = any (p_channels) then
    perform private.enqueue(p_template, 'sms', c.mobile, 'clinician', c.id, p_payload, p_at);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Signing up: the welcome email carries their private link (no portal login).
-- ---------------------------------------------------------------------------

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
  perform private.notify_clinician('clinician_welcome', v_id, '{}');
  perform private.notify_staff('new_application',
    jsonb_build_object('clinician_id', v_id, 'clinician_name', btrim(p ->> 'name'), 'profession', p ->> 'profession'));
  return v_id;
end $$;

drop function if exists public.link_clinician_portal(uuid, uuid, text, text);

-- A portal login is no longer part of going live.
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

-- ---------------------------------------------------------------------------
-- The clinician's own page. Server only: the app has checked their signed link.
-- ---------------------------------------------------------------------------

-- What's still missing before they can submit their application.
create or replace function public.clinician_application_gaps(p_clinician uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.clinicians;
begin
  if not (private.is_service() or private.is_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician;
  return private.application_gaps(c);
end $$;

-- Submit the application, accepting the service agreement. Emails them the intake-call booking link.
create or replace function public.submit_clinician_application(p_clinician uuid, p_agreement_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  v_gaps text[];
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician for update;
  if not found or c.status = 'offboarded' then
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

drop function if exists public.submit_my_application(text);

-- Record a document they've uploaded (the file is already in private storage). It joins the verification queue.
create or replace function public.record_clinician_upload(p_clinician uuid, p_type public.credential_type, p_number text,
  p_expires_at date, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_type in ('drivers_licence', 'car_insurance') then
    raise exception 'Please don''t upload a copy of this: the team will sight it' using errcode = 'P0001';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_clinician::text then
    raise exception 'Upload the file first' using errcode = 'P0001';
  end if;
  if private.expiry_tracked(p_type) and p_expires_at is null then
    raise exception 'Enter the expiry date shown on the document' using errcode = 'P0001';
  end if;
  insert into public.credentials (clinician_id, type, number, expires_at, file_path, status)
  values (p_clinician, p_type, nullif(btrim(p_number), ''), p_expires_at, p_path, 'pending');
end $$;

-- The yearly "my details are still right" confirmation.
create or replace function public.confirm_clinician_details(p_clinician uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.clinicians set last_recredentialed_at = now() where id = p_clinician;
end $$;

-- Staff: email a clinician their link, or cancel the old link and email a new one.
create or replace function public.send_clinician_link(p_clinician uuid, p_reset boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_reset then
    update public.clinicians set link_version = link_version + 1 where id = p_clinician;
  end if;
  perform private.notify_clinician('clinician_link', p_clinician, '{}');
end $$;

drop function if exists public.send_availability_link(uuid, boolean);

-- "Email me my link" (public page, server only). Says nothing about whether the email is known.
create or replace function public.request_clinician_link(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select id into v_id from public.clinicians where lower(email) = lower(btrim(p_email)) and status <> 'offboarded';
  if v_id is not null then
    perform private.notify_clinician('clinician_link', v_id, '{}');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Referrals: offer → accept or decline.
-- ---------------------------------------------------------------------------

-- The de-identified summary a clinician sees before accepting: never names, contact details or address.
create or replace function private.referral_summary(m public.matches) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.families;
  ch public.children;
begin
  select * into f from public.families where id = m.family_id;
  select * into ch from public.children where id = m.child_id;
  return jsonb_build_object(
    'match_id', m.id, 'suburb', f.suburb, 'child_age', private.age_years(ch.dob, ch.age_years),
    'service_type', ch.service_type, 'funding_type', f.funding_type, 'concerns', to_jsonb(ch.concerns),
    'concern_other', ch.concern_other, 'preferred_times', to_jsonb(ch.preferred_times), 'language', ch.language,
    'telehealth_ok', ch.telehealth_ok, 'offer_expires_at', m.offer_expires_at);
end $$;

-- Staff allocate a clinician: the clinician is offered the client and accepts or declines from the email.
create or replace function public.allocate_clinician(p_family uuid, p_clinician uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
  v_child public.children;
  c public.clinicians;
  o record;
  v_match public.matches;
  v_hours integer := coalesce(private.setting_int('offer_response_hours'), 48);
begin
  perform private.require_staff();
  if auth.uid() is null then
    raise exception 'A person must allocate every clinician';
  end if;

  select * into f from public.families where id = p_family for update;
  if not found then
    raise exception 'Family not found' using errcode = 'P0001';
  end if;
  if f.status not in ('ready_to_match', 'waitlist', 'offered', 'accepted', 'intro_booked', 'intro_done') then
    raise exception 'Complete the sign-up call before allocating a clinician' using errcode = 'P0001';
  end if;
  if f.complex_case and not private.can_approve_complex() then
    raise exception 'This is a complex case: a clinical lead needs to allocate the clinician' using errcode = '42501';
  end if;

  select * into v_child from public.children where family_id = f.id order by created_at limit 1;
  if not found then
    raise exception 'Add the child''s details first' using errcode = 'P0001';
  end if;

  select * into c from public.clinicians where id = p_clinician for update;
  if not found or c.status <> 'active' then
    raise exception 'Only active clinicians can be allocated' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.availability a where a.clinician_id = c.id) then
    raise exception '% has no available times for intro calls yet: ask them to add some from their link', c.name using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches where child_id = v_child.id and clinician_id = c.id and state in ('offered', 'accepted')) then
    raise exception '% has already been offered this client', c.name using errcode = 'P0001';
  end if;

  -- Clear anything live for this child: shortlists, open offers and the previous clinician.
  for o in
    update public.matches
       set state = 'withdrawn', response_reason = 'Clinician changed by staff'
     where child_id = v_child.id and state in ('proposed', 'offered', 'accepted')
    returning id, clinician_id, (offered_at is not null) as was_offered,
              (responded_at is not null and approved_at is not null) as was_allocated
  loop
    if o.was_allocated then
      update public.clinicians set capacity_new = capacity_new + 1 where id = o.clinician_id;
      -- their intro call, if booked, is off
      update public.appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Clinician changed'
       where match_id = o.id and status = 'booked';
      perform private.notify_clinician('allocation_removed', o.clinician_id,
        jsonb_build_object('child_first_name', v_child.first_name, 'suburb', f.suburb));
    elsif o.was_offered then
      perform private.notify_clinician('offer_withdrawn', o.clinician_id, '{}');
    end if;
  end loop;

  insert into public.matches (family_id, child_id, clinician_id, state, rank, proposed_by, approved_by, approved_at,
                              offered_at, offer_expires_at)
  values (f.id, v_child.id, c.id, 'offered', 1, auth.uid(), auth.uid(), now(), now(), now() + make_interval(hours => v_hours))
  returning * into v_match;

  if f.status in ('accepted', 'intro_booked', 'intro_done') then
    perform private.set_family_status(f.id, 'ready_to_match', 'Clinician changed');
  end if;
  perform private.set_family_status(f.id, 'offered', 'Offered to ' || c.name);

  perform private.notify_clinician('offer_sent', c.id,
    private.referral_summary(v_match) || jsonb_build_object('response_hours', v_hours),
    array['email', 'sms']::public.message_channel[]);
  return v_match.id;
end $$;

-- An offer ended without an acceptance: back to Ready to match (unless another offer is still open) and tell staff.
create or replace function private.referral_closed(m public.matches, p_template text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_child public.children;
  c public.clinicians;
begin
  -- the old shortlist flow: offer the next clinician on the list
  if exists (select 1 from public.matches where child_id = m.child_id and state = 'proposed' and approved_at is not null) then
    perform private.advance_offers(m.child_id);
    return;
  end if;
  if exists (select 1 from public.matches where child_id = m.child_id and state in ('offered', 'accepted')) then
    return;
  end if;
  select * into v_child from public.children where id = m.child_id;
  select * into c from public.clinicians where id = m.clinician_id;
  perform private.set_family_status(m.family_id, 'ready_to_match', p_reason);
  perform private.notify_staff(p_template,
    jsonb_build_object('family_id', m.family_id, 'child_first_name', v_child.first_name, 'clinician_name', c.name,
                       'reason', coalesce(nullif(btrim(m.response_reason), ''), 'no reason given')));
end $$;

-- The family's details for the clinician, sent by email once they accept.
create or replace function private.family_details(m public.matches) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.families;
  ch public.children;
begin
  select * into f from public.families where id = m.family_id;
  select * into ch from public.children where id = m.child_id;
  return private.referral_summary(m) || jsonb_build_object(
    'family_id', f.id, 'parent_name', f.parent_name, 'parent_mobile', f.mobile, 'parent_email', f.email,
    'postcode', f.postcode, 'plan_manager', f.plan_manager, 'child_first_name', ch.first_name,
    'notes_intake', ch.notes_intake);
end $$;

-- Accept or decline an offer. Both the old portal function and the referral link use this.
create or replace function private.respond_to_offer_core(p_match uuid, p_accept boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  c public.clinicians;
  v_child public.children;
  o record;
begin
  select * into m from public.matches where id = p_match;
  if not found then
    raise exception 'Referral not found' using errcode = 'P0002';
  end if;
  -- lock the family first (same order as advance_offers) so parallel accepts can't both win
  perform 1 from public.families where id = m.family_id for update;
  select * into m from public.matches where id = p_match for update;
  if m.state <> 'offered' then
    raise exception 'This referral is no longer open' using errcode = 'P0001';
  end if;
  if m.offer_expires_at < now() then
    raise exception 'This referral has closed' using errcode = 'P0001';
  end if;

  if p_accept then
    update public.matches set state = 'accepted', responded_at = now(), response_reason = nullif(btrim(p_reason), '')
     where id = m.id returning * into m;
    for o in
      update public.matches set state = 'withdrawn', response_reason = 'Another clinician accepted'
       where child_id = m.child_id and state in ('offered', 'proposed') and id <> m.id
      returning clinician_id, (offered_at is not null) as was_offered
    loop
      if o.was_offered then
        perform private.notify_clinician('offer_withdrawn', o.clinician_id, '{}');
      end if;
    end loop;
    update public.clinicians set capacity_new = greatest(capacity_new - 1, 0) where id = m.clinician_id returning * into c;
    perform private.set_family_status(m.family_id, 'accepted', c.name || ' accepted');
    select * into v_child from public.children where id = m.child_id;
    perform private.notify_family('match_confirmed', m.family_id,
      jsonb_build_object('match_id', m.id, 'clinician_name', c.name, 'clinician_first_name', split_part(c.name, ' ', 1),
                         'child_first_name', v_child.first_name));
    perform private.notify_clinician('clinician_allocated', c.id, private.family_details(m));
    perform private.notify_staff('offer_accepted',
      jsonb_build_object('family_id', m.family_id, 'clinician_name', c.name, 'child_first_name', v_child.first_name));
  else
    update public.matches set state = 'declined', responded_at = now(), response_reason = nullif(btrim(p_reason), '')
     where id = m.id returning * into m;
    select * into c from public.clinicians where id = m.clinician_id;
    perform private.referral_closed(m, 'offer_declined', c.name || ' declined');
  end if;
end $$;

-- Server only: the clinician answered from their referral link.
create or replace function public.respond_to_referral(p_match uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.respond_to_offer_core(p_match, p_accept, p_reason);
end $$;

-- Signed-in clinicians (kept for the older shortlist flow and its tests).
create or replace function public.respond_to_offer(p_match uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinician uuid := private.current_clinician_id();
begin
  if v_clinician is null then
    raise exception 'Only the clinician who received the offer can respond' using errcode = '42501';
  end if;
  if not exists (select 1 from public.matches where id = p_match and clinician_id = v_clinician) then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  perform private.respond_to_offer_core(p_match, p_accept, p_reason);
end $$;

-- Unanswered offers close after the response window; a text nudges them halfway.
create or replace function private.run_offer_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  v_timeouts integer := 0;
  v_nudges integer := 0;
  v_nudge_hours integer := coalesce(private.setting_int('offer_nudge_hours'), 24);
  c public.clinicians;
begin
  for m in
    select * from public.matches
     where state = 'offered' and offer_expires_at < now()
     for update skip locked
  loop
    update public.matches set state = 'timeout', responded_at = now() where id = m.id returning * into m;
    select * into c from public.clinicians where id = m.clinician_id;
    perform private.referral_closed(m, 'offer_expired', c.name || ' didn''t reply in time');
    v_timeouts := v_timeouts + 1;
  end loop;

  for m in
    select * from public.matches
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

-- The intro call and the first session can be recorded from the referral link (service role) as well as by staff.
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
  if not found or not (private.is_service() or private.is_staff() or m.clinician_id = private.current_clinician_id()) then
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

create or replace function public.confirm_first_session(p_match uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select clinician_id into v_owner from public.matches where id = p_match;
  if not (private.is_service() or private.is_staff() or v_owner = private.current_clinician_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.confirm_first_session_core(p_match, p_date, auth.uid());
end $$;

-- A clinician hosting an intro call gets a link to their referral page (to record how it went), not a portal page.
create or replace function private.notify_appointment(a public.appointments, p_template_subject text, p_template_host text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb := private.appointment_payload(a);
  v_staff public.profiles;
  v_family public.families;
  v_clinician public.clinicians;
  v_contact text;
  v_record text;
begin
  -- the person who booked
  if a.kind = 'clinician_intake' then
    perform private.notify_clinician(p_template_subject, a.clinician_id, v_payload);
  else
    perform private.notify_family(p_template_subject, a.family_id, v_payload, array['email']::public.message_channel[]);
  end if;
  -- the host, with who to call and where their record is
  if a.host_profile_id is not null then
    select * into v_staff from public.profiles where id = a.host_profile_id;
    if a.kind = 'clinician_intake' then
      select * into v_clinician from public.clinicians where id = a.clinician_id;
      v_contact := 'Call them on ' || coalesce(v_clinician.mobile, 'the number in their record') || '.';
      v_record := '/clinicians/' || a.clinician_id;
    else
      select * into v_family from public.families where id = a.family_id;
      v_contact := 'Call them on ' || v_family.mobile || '.';
      v_record := '/families/' || a.family_id;
    end if;
    perform private.enqueue(p_template_host, 'email', v_staff.email, 'staff', v_staff.id,
      v_payload || jsonb_build_object('recipient_first_name', split_part(v_staff.full_name, ' ', 1),
                                      'host_contact_line', v_contact, 'record_path', v_record));
  else
    select * into v_family from public.families where id = a.family_id;
    perform private.notify_clinician(p_template_host, a.host_clinician_id,
      v_payload || jsonb_build_object(
        'host_contact_line', 'Call ' || v_family.parent_name || ' on ' || v_family.mobile || ' at that time. Afterwards, tell us how it went:',
        'referral_match_id', a.match_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Portal-only functions and grants
-- ---------------------------------------------------------------------------

revoke execute on function
  public.clinician_application_gaps(uuid),
  public.submit_clinician_application(uuid, text),
  public.record_clinician_upload(uuid, public.credential_type, text, date, text),
  public.confirm_clinician_details(uuid),
  public.send_clinician_link(uuid, boolean),
  public.request_clinician_link(text),
  public.respond_to_referral(uuid, boolean, text)
from public, anon;
revoke execute on function
  public.submit_clinician_application(uuid, text),
  public.record_clinician_upload(uuid, public.credential_type, text, date, text),
  public.confirm_clinician_details(uuid),
  public.request_clinician_link(text),
  public.respond_to_referral(uuid, boolean, text)
from authenticated;
grant execute on function
  public.submit_clinician_application(uuid, text),
  public.record_clinician_upload(uuid, public.credential_type, text, date, text),
  public.confirm_clinician_details(uuid),
  public.request_clinician_link(text),
  public.respond_to_referral(uuid, boolean, text),
  public.clinician_application_gaps(uuid),
  public.record_intro_outcome(uuid, public.intro_outcome, text),
  public.confirm_first_session(uuid, date)
to service_role;
grant execute on function public.clinician_application_gaps(uuid), public.send_clinician_link(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

delete from public.message_templates where key = 'availability_link';

update public.message_templates set subject = 'Welcome to Perch: your next steps', body =
'Hi {{clinician_first_name}},

Thanks for signing up to join our clinician network.

Everything you need is on your own page, no login needed: {{clinician_url}}

There, please:
1. complete your profile (the ages and funding types you work with),
2. set your available times for free intro calls with families,
3. upload your documents (registration, Working with Children Check, NDIS screening, insurance and ABN),
4. accept the service agreement and submit your application.

Once it''s submitted, we''ll send you a link to book a short intake call.

Keep this email: the link is private to you. Lost it? Get it again at {{app_url}}/link

The Switchboard team',
 description = 'Clinician: welcome after signing up, with their private link'
 where key = 'clinician_welcome' and channel = 'email';

update public.message_templates set body =
'Hi {{clinician_first_name}},

Thanks for your time on the intake call. You''re now set up to receive clients through Perch.

When we have a family for you, we''ll email you a short summary to accept or decline. Keep your capacity, available times and documents up to date on your page: {{clinician_url}}

The Switchboard team'
 where key = 'clinician_ready' and channel = 'email';

update public.message_templates set subject = 'New referral: {{child_age}}-year-old in {{suburb}}', body =
'Hi {{clinician_first_name}},

We''d like to refer a new client to you:

{{referral_summary}}

Accept or decline here: {{referral_url}}

Please reply by {{offer_expires_at_local}}. Declining is completely fine and has no effect on future referrals. We''ll send you the family''s details once you accept.

The Switchboard team'
 where key = 'offer_sent' and channel = 'email';

update public.message_templates set body =
'New Perch referral: {{child_age}}yo in {{suburb}}. Accept or decline by {{offer_expires_at_local}}: {{referral_url}}'
 where key = 'offer_sent' and channel = 'sms';

update public.message_templates set body =
'Reminder: a Perch referral is waiting for your answer. It closes {{offer_expires_at_local}}. {{referral_url}}'
 where key = 'offer_nudge' and channel = 'sms';

update public.message_templates set subject = 'New client: {{child_first_name}} ({{suburb}})', body =
'Hi {{clinician_first_name}},

Thanks for accepting {{child_first_name}}. {{parent_name}} has been sent a link to book a free intro call in your available times, and we''ll email you when they do.

{{family_details}}

After the intro call, tell us how it went (and later, the date of the first session) here: {{referral_url}}

This email has the family''s personal details, so please keep it private.

The Switchboard team'
 where key = 'clinician_allocated' and channel = 'email';

update public.message_templates set body =
'Reminder: Perch intro call at {{starts_at_local}}. The family''s details are in our email.'
 where key = 'intro_reminder_clinician' and channel = 'sms';

update public.message_templates set body =
'Hi {{clinician_first_name}},

It''s been a year, so please take two minutes to confirm your profile, capacity and insurance are still right: {{clinician_url}}

The Switchboard team'
 where key = 'recredential_prompt' and channel = 'email';

insert into public.message_templates (key, channel, subject, body, description) values
('clinician_link', 'email', 'Your Perch link',
'Hi {{clinician_first_name}},

Here''s your private link to your Perch page, where you can update your profile, available times, days off and documents (no login needed):
{{clinician_url}}

Keep it private: anyone with the link can change your details. Any earlier link no longer works if we''ve reset it.

The Switchboard team', 'Clinician: their private link (sent or reset by staff, or requested by them)'),

('offer_declined', 'email', '{{clinician_name}} declined {{child_first_name}}',
'{{clinician_name}} declined the referral for {{child_first_name}} ({{reason}}). They''re back in Ready to match: allocate another clinician. {{app_url}}/families/{{family_id}}',
'Staff: a clinician declined a referral'),

('offer_declined', 'slack', null,
':no_entry_sign: {{clinician_name}} declined {{child_first_name}} ({{reason}}). Allocate another clinician: {{app_url}}/families/{{family_id}}',
'Staff: a clinician declined a referral'),

('offer_expired', 'email', 'No reply from {{clinician_name}} about {{child_first_name}}',
'{{clinician_name}} didn''t reply in time to the referral for {{child_first_name}}. They''re back in Ready to match: allocate another clinician. {{app_url}}/families/{{family_id}}',
'Staff: a referral offer expired without a reply'),

('offer_expired', 'slack', null,
':hourglass: {{clinician_name}} didn''t reply about {{child_first_name}}. Allocate another clinician: {{app_url}}/families/{{family_id}}',
'Staff: a referral offer expired without a reply')
on conflict (key, channel) do nothing;
