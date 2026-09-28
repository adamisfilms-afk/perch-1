-- Switchboard's own booking system, replacing Cal.com.
--
-- Three kinds of call:
--   signup_call       a family books a sign-up call with the Perch team (hosts: staff who take sign-up calls)
--   clinician_intake  a clinician books their intake call with the Perch team (hosts: staff who take clinician calls)
--   intro_call        a family books a free intro call with their allocated clinician
--
-- Staff set their weekly hours in Switchboard; clinicians set theirs (the existing availability table)
-- from a private link, no login. Booking pages are opened from signed links in emails (see
-- src/lib/booking/links.ts); the app works out free times and calls book_appointment() with the
-- service role. Each booking is passed to record_booking(), so the pipeline moves exactly as it did
-- with Cal.com: statuses, intake/intro call records and SMS reminders. Cancelling moves it back.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

alter table public.profiles
  add column timezone text not null default 'Australia/Sydney',
  add column hosts_signup_calls boolean not null default false,
  add column hosts_clinician_calls boolean not null default false;

alter table public.clinicians
  add column timezone text not null default 'Australia/Sydney',
  add column availability_link_version integer not null default 1;

-- Weekly hours for staff who take calls (clinicians use public.availability).
create table public.staff_availability (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),  -- ISO: 1 = Monday
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time)
);
create index staff_availability_profile_idx on public.staff_availability (profile_id);

-- Days off (inclusive), for staff or clinicians.
create table public.time_off (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles (id) on delete cascade,
  clinician_id uuid references public.clinicians (id) on delete cascade,
  starts_on    date not null,
  ends_on      date not null,
  note         text check (length(note) <= 200),
  created_at   timestamptz not null default now(),
  check (num_nonnulls(profile_id, clinician_id) = 1),
  check (ends_on >= starts_on)
);
create index time_off_owner_idx on public.time_off (coalesce(profile_id, clinician_id), ends_on);

create type public.appointment_kind as enum ('signup_call', 'clinician_intake', 'intro_call');

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  kind              public.appointment_kind not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  host_profile_id   uuid references public.profiles (id),
  host_clinician_id uuid references public.clinicians (id) on delete cascade,
  host_id           uuid generated always as (coalesce(host_profile_id, host_clinician_id)) stored,
  family_id         uuid references public.families (id) on delete cascade,
  clinician_id      uuid references public.clinicians (id) on delete cascade,  -- the applicant, for clinician_intake
  match_id          uuid references public.matches (id) on delete cascade,
  status            text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at      timestamptz,
  cancel_reason     text check (length(cancel_reason) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  check (num_nonnulls(host_profile_id, host_clinician_id) = 1),
  check (case kind when 'signup_call' then family_id is not null and host_profile_id is not null
                   when 'clinician_intake' then clinician_id is not null and host_profile_id is not null
                   when 'intro_call' then match_id is not null and host_clinician_id is not null end),
  -- nobody can be booked twice at the same time
  exclude using gist (host_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'booked')
);
-- one live booking per call: rescheduling moves it, it doesn't add another
create unique index appointments_one_live on public.appointments (kind, coalesce(match_id, clinician_id, family_id))
  where status = 'booked';
create index appointments_host_idx on public.appointments (host_id, starts_at) where status = 'booked';
create trigger appointments_touch before update on public.appointments for each row execute function private.touch_updated_at();

alter table public.staff_availability enable row level security;
alter table public.time_off enable row level security;
alter table public.appointments enable row level security;

create policy staff_availability_select on public.staff_availability for select to authenticated using ((select private.is_staff()));
create policy time_off_staff on public.time_off for select to authenticated using ((select private.is_staff()));
create policy time_off_self on public.time_off for select to authenticated
  using (clinician_id = (select private.current_clinician_id()));
create policy appointments_staff on public.appointments for select to authenticated using ((select private.is_staff()));
create policy appointments_clinician on public.appointments for select to authenticated
  using (host_clinician_id = (select private.current_clinician_id()) or clinician_id = (select private.current_clinician_id()));

-- Changes go through the functions below (which check who's asking); no direct writes.
revoke insert, update, delete on public.staff_availability, public.time_off, public.appointments from authenticated, anon;

-- Clinicians' intro calls need available times, not a Cal.com link.
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

create or replace function public.allocate_clinician(p_family uuid, p_clinician uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
  v_child public.children;
  c public.clinicians;
  o record;
  v_match uuid;
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
    raise exception '% has no available times for intro calls yet: ask them to add some from their availability link', c.name using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches where child_id = v_child.id and clinician_id = c.id and state = 'accepted') then
    raise exception '% is already allocated to this client', c.name using errcode = 'P0001';
  end if;

  -- Clear anything live for this child: shortlists, open offers and the previous clinician.
  for o in
    update public.matches
       set state = 'withdrawn', response_reason = 'Clinician changed by staff'
     where child_id = v_child.id and state in ('proposed', 'offered', 'accepted')
    returning clinician_id, (offered_at is not null) as was_offered,
              (responded_at is not null and approved_at is not null) as was_allocated
  loop
    if o.was_allocated then
      update public.clinicians set capacity_new = capacity_new + 1 where id = o.clinician_id;
      perform private.notify_clinician('allocation_removed', o.clinician_id,
        jsonb_build_object('child_first_name', v_child.first_name, 'suburb', f.suburb));
    elsif o.was_offered then
      perform private.notify_clinician('offer_withdrawn', o.clinician_id, '{}');
    end if;
  end loop;

  -- offered_at is set too, so the allocation shows wherever referrals are listed.
  insert into public.matches (family_id, child_id, clinician_id, state, rank, proposed_by, approved_by, approved_at,
                              offered_at, responded_at)
  values (f.id, v_child.id, c.id, 'accepted', 1, auth.uid(), auth.uid(), now(), now(), now())
  returning id into v_match;
  update public.clinicians set capacity_new = greatest(capacity_new - 1, 0) where id = c.id;

  perform private.set_family_status(f.id, 'accepted', 'Allocated to ' || c.name);

  perform private.notify_family('match_confirmed', f.id,
    jsonb_build_object('match_id', v_match, 'clinician_name', c.name, 'clinician_first_name', split_part(c.name, ' ', 1),
                       'child_first_name', v_child.first_name));
  perform private.notify_clinician('clinician_allocated', c.id,
    jsonb_build_object('match_id', v_match, 'family_id', f.id, 'child_first_name', v_child.first_name,
                       'child_age', private.age_years(v_child.dob, v_child.age_years), 'suburb', f.suburb,
                       'parent_name', f.parent_name));
  return v_match;
end $$;

-- Clinician messages carry the version of their availability link, so emails can include it.
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
                                  'availability_link_version', c.availability_link_version) || coalesce(p_payload, '{}');
  if 'email' = any (p_channels) then
    perform private.enqueue(p_template, 'email', c.email, 'clinician', c.id, p_payload, p_at);
  end if;
  if 'sms' = any (p_channels) then
    perform private.enqueue(p_template, 'sms', c.mobile, 'clinician', c.id, p_payload, p_at);
  end if;
end $$;

create or replace function private.require_staff_or_service() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service() then
    perform private.require_staff();
  end if;
end $$;

create or replace function private.replace_windows(p_table text, p_owner uuid, p_windows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w jsonb;
begin
  if p_table = 'staff' then
    delete from public.staff_availability where profile_id = p_owner;
  else
    delete from public.availability where clinician_id = p_owner;
  end if;
  for w in select * from jsonb_array_elements(coalesce(p_windows, '[]'))
  loop
    if (w ->> 'end')::time <= (w ->> 'start')::time then
      raise exception 'Each time block must end after it starts' using errcode = 'P0001';
    end if;
    if p_table = 'staff' then
      insert into public.staff_availability (profile_id, day_of_week, start_time, end_time)
      values (p_owner, (w ->> 'day')::smallint, (w ->> 'start')::time, (w ->> 'end')::time);
    else
      insert into public.availability (clinician_id, day_of_week, start_time, end_time)
      values (p_owner, (w ->> 'day')::smallint, (w ->> 'start')::time, (w ->> 'end')::time);
    end if;
  end loop;
end $$;

-- A staff member's weekly hours and which calls they take. Themselves, or an admin for anyone.
create or replace function public.save_staff_availability(p_profile uuid, p_timezone text, p_hosts_signup boolean,
  p_hosts_clinician boolean, p_windows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_profile <> auth.uid() and not private.is_admin() then
    raise exception 'You can only change your own availability' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = 'P0001';
  end if;
  update public.profiles
     set timezone = p_timezone, hosts_signup_calls = p_hosts_signup, hosts_clinician_calls = p_hosts_clinician
   where id = p_profile;
  perform private.replace_windows('staff', p_profile, p_windows);
end $$;

-- A clinician's weekly hours for intro calls. From their private link (service role) or by staff.
create or replace function public.save_clinician_availability(p_clinician uuid, p_timezone text, p_windows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff_or_service();
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = 'P0001';
  end if;
  update public.clinicians set timezone = p_timezone where id = p_clinician;
  perform private.replace_windows('clinician', p_clinician, p_windows);
end $$;

create or replace function public.add_time_off(p_profile uuid, p_clinician uuid, p_starts date, p_ends date, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_profile is not null then
    perform private.require_staff();
    if p_profile <> auth.uid() and not private.is_admin() then
      raise exception 'You can only change your own time off' using errcode = '42501';
    end if;
  else
    perform private.require_staff_or_service();
  end if;
  if p_ends < p_starts then
    raise exception 'The last day off must be on or after the first' using errcode = 'P0001';
  end if;
  insert into public.time_off (profile_id, clinician_id, starts_on, ends_on, note)
  values (p_profile, case when p_profile is null then p_clinician end, p_starts, p_ends, nullif(btrim(p_note), ''));
end $$;

create or replace function public.remove_time_off(p_id uuid, p_clinician uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.time_off;
begin
  select * into t from public.time_off where id = p_id;
  if not found then
    return;
  end if;
  if private.is_service() then
    if t.clinician_id is distinct from p_clinician then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  else
    perform private.require_staff();
    if t.profile_id is not null and t.profile_id <> auth.uid() and not private.is_admin() then
      raise exception 'You can only change your own time off' using errcode = '42501';
    end if;
  end if;
  delete from public.time_off where id = p_id;
end $$;

-- What a booking is about, for messages: who booked, with whom, and the record to open.
create or replace function private.appointment_payload(a public.appointments) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_host_name text;
  v_subject text;
  v_child text;
  v_label text := case a.kind when 'signup_call' then 'sign-up call' when 'clinician_intake' then 'intake call' else 'intro call' end;
begin
  if a.host_profile_id is not null then
    select full_name into v_host_name from public.profiles where id = a.host_profile_id;
  else
    select name into v_host_name from public.clinicians where id = a.host_clinician_id;
  end if;
  if a.kind = 'clinician_intake' then
    select name into v_subject from public.clinicians where id = a.clinician_id;
  else
    select parent_name into v_subject from public.families where id = a.family_id;
    select first_name into v_child from public.children where family_id = a.family_id order by created_at limit 1;
  end if;
  return jsonb_build_object(
    'appointment_id', a.id, 'appointment_kind', a.kind, 'call_label', v_label,
    'starts_at', a.starts_at, 'minutes', round(extract(epoch from a.ends_at - a.starts_at) / 60),
    'host_name', v_host_name, 'host_first_name', split_part(v_host_name, ' ', 1),
    'subject_name', v_subject, 'child_first_name', v_child,
    'family_id', a.family_id, 'booked_match_id', a.match_id, 'booked_clinician_id', a.clinician_id);
end $$;

-- Email the person who booked, and the host.
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
      v_payload || jsonb_build_object('host_contact_line', 'Call ' || v_family.parent_name || ' on ' || v_family.mobile || ' at that time.',
                                      'record_path', '/portal/families'));
  end if;
end $$;

-- Book a call. Server only: the app has already checked the signed link and that the time is free.
-- p_ref is the family (signup_call), the clinician applicant (clinician_intake) or the match (intro_call).
create or replace function public.book_appointment(p_kind public.appointment_kind, p_ref uuid, p_starts_at timestamptz,
  p_minutes integer, p_host_profile uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  f public.families;
  c public.clinicians;
  m public.matches;
  v_result text;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 240 then
    raise exception 'Unexpected call length' using errcode = 'P0001';
  end if;

  if p_kind = 'signup_call' then
    select * into f from public.families where id = p_ref;
    if not found or f.status not in ('new', 'contacted', 'intake_booked') then
      raise exception 'This sign-up call can no longer be booked' using errcode = 'P0001';
    end if;
    insert into public.appointments (kind, starts_at, ends_at, host_profile_id, family_id)
    values (p_kind, p_starts_at, p_starts_at + make_interval(mins => p_minutes), p_host_profile, f.id) returning * into a;
    v_result := public.record_booking('intake', f.id, null, p_starts_at, 'sb-' || a.id, false);
  elsif p_kind = 'clinician_intake' then
    select * into c from public.clinicians where id = p_ref;
    if not found or c.application_submitted_at is null or c.status not in ('applied', 'screening') then
      raise exception 'This intake call can no longer be booked' using errcode = 'P0001';
    end if;
    insert into public.appointments (kind, starts_at, ends_at, host_profile_id, clinician_id)
    values (p_kind, p_starts_at, p_starts_at + make_interval(mins => p_minutes), p_host_profile, c.id) returning * into a;
    v_result := public.record_booking('screening', c.id, null, p_starts_at, 'sb-' || a.id, false);
  else
    select * into m from public.matches where id = p_ref;
    if not found or m.state <> 'accepted' then
      raise exception 'This intro call can no longer be booked' using errcode = 'P0001';
    end if;
    insert into public.appointments (kind, starts_at, ends_at, host_clinician_id, family_id, match_id)
    values (p_kind, p_starts_at, p_starts_at + make_interval(mins => p_minutes), m.clinician_id, m.family_id, m.id) returning * into a;
    v_result := public.record_booking('intro', m.id, null, p_starts_at, 'sb-' || a.id, false);
  end if;

  perform private.notify_appointment(a, 'booking_confirmed', 'booking_host');
  return a.id;
exception
  when exclusion_violation then
    raise exception 'Sorry, that time has just been taken. Please choose another.' using errcode = 'P0001';
  when unique_violation then
    raise exception 'This call is already booked. Change the existing booking instead.' using errcode = 'P0001';
end $$;

-- Move a booking to a new time (and, for team calls, possibly a different host). Server only.
create or replace function public.reschedule_appointment(p_id uuid, p_starts_at timestamptz, p_host_profile uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  v_minutes interval;
  v_result text;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.status <> 'booked' then
    raise exception 'This booking has been cancelled' using errcode = 'P0001';
  end if;
  v_minutes := a.ends_at - a.starts_at;
  update public.appointments
     set starts_at = p_starts_at, ends_at = p_starts_at + v_minutes,
         host_profile_id = case when a.host_profile_id is not null then coalesce(p_host_profile, a.host_profile_id) end
   where id = a.id
  returning * into a;
  v_result := public.record_booking(case a.kind when 'signup_call' then 'intake' when 'clinician_intake' then 'screening' else 'intro' end,
    coalesce(a.match_id, a.clinician_id, a.family_id), null, p_starts_at, 'sb-' || a.id, false);
  perform private.notify_appointment(a, 'booking_moved', 'booking_moved_host');
exception
  when exclusion_violation then
    raise exception 'Sorry, that time has just been taken. Please choose another.' using errcode = 'P0001';
end $$;

-- Cancel a booking: from the booking link (service role) or by staff. The pipeline steps back
-- (Intake call booked → Contacted, Intro booked → Matched, Intake call booked → Application complete).
create or replace function public.cancel_appointment(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  v_result text;
begin
  perform private.require_staff_or_service();
  select * into a from public.appointments where id = p_id for update;
  if not found or a.status <> 'booked' then
    return;
  end if;
  update public.appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
   where id = a.id returning * into a;
  v_result := public.record_booking(case a.kind when 'signup_call' then 'intake' when 'clinician_intake' then 'screening' else 'intro' end,
    coalesce(a.match_id, a.clinician_id, a.family_id), null, a.starts_at, 'sb-' || a.id, true);
  if a.kind = 'clinician_intake' then
    perform set_config('app.status_reason', 'Intake call cancelled', true);
    update public.clinicians set status = 'applied' where id = a.clinician_id and status = 'screening';
    perform set_config('app.status_reason', '', true);
  end if;
  perform private.notify_appointment(a, 'booking_cancelled', 'booking_cancelled_host');
end $$;

-- Staff: email a clinician their availability link, or cancel the old link and send a new one.
create or replace function public.send_availability_link(p_clinician uuid, p_reset boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_reset then
    update public.clinicians set availability_link_version = availability_link_version + 1 where id = p_clinician;
  end if;
  perform private.notify_clinician('availability_link', p_clinician, '{}');
end $$;

revoke execute on function public.send_availability_link(uuid, boolean) from public, anon;
grant execute on function public.send_availability_link(uuid, boolean) to authenticated;

revoke execute on function
  public.save_staff_availability(uuid, text, boolean, boolean, jsonb),
  public.save_clinician_availability(uuid, text, jsonb),
  public.add_time_off(uuid, uuid, date, date, text),
  public.remove_time_off(uuid, uuid),
  public.book_appointment(public.appointment_kind, uuid, timestamptz, integer, uuid),
  public.reschedule_appointment(uuid, timestamptz, uuid),
  public.cancel_appointment(uuid, text)
from public, anon;
revoke execute on function
  public.book_appointment(public.appointment_kind, uuid, timestamptz, integer, uuid),
  public.reschedule_appointment(uuid, timestamptz, uuid)
from authenticated;
grant execute on function
  public.save_staff_availability(uuid, text, boolean, boolean, jsonb),
  public.save_clinician_availability(uuid, text, jsonb),
  public.add_time_off(uuid, uuid, date, date, text),
  public.remove_time_off(uuid, uuid),
  public.cancel_appointment(uuid, text)
to authenticated, service_role;
grant execute on function
  public.book_appointment(public.appointment_kind, uuid, timestamptz, integer, uuid),
  public.reschedule_appointment(uuid, timestamptz, uuid)
to service_role;
grant execute on function private.require_staff_or_service() to authenticated, service_role;

insert into public.settings (key, value, description) values
  ('booking',
   '{"signup_call_minutes": 15, "clinician_intake_minutes": 30, "intro_call_minutes": 15, "min_notice_hours": 12, "horizon_days": 21}',
   'Booking: length of each kind of call (minutes), minimum notice (hours) and how far ahead people can book (days)')
on conflict (key) do nothing;

-- Messages: booking links now point at Switchboard, not Cal.com.
update public.message_templates
   set body = replace(body, '{{calcom_intro_url}}', '{{intro_booking_url}}')
 where key = 'match_confirmed';

update public.message_templates set body =
'Hi {{clinician_first_name}},

Thanks for signing up to join our clinician network.

Set your password here to open your portal: {{portal_invite_url}}

In the portal, please:
1. complete your profile (the ages and funding types you work with),
2. set your available times for free intro calls with families: {{availability_url}} (no login needed, so keep this link),
3. upload your documents (registration, Working with Children Check, NDIS screening, insurance and ABN),
4. accept the service agreement and submit your application.

Once it''s submitted, we''ll send you a link to book a short intake call.

If the link has expired, request a new one at {{app_url}}/forgot.

The Switchboard team'
 where key = 'clinician_welcome' and channel = 'email';

update public.message_templates set body =
'Hi {{clinician_first_name}},

We''ve matched you with {{child_first_name}}, a {{child_age}}-year-old in {{suburb}}. {{parent_name}} has been sent a link to book a free intro call in your available times, and we''ll email you as soon as they do.

Keep your available times up to date here (no login needed): {{availability_url}}

You can see their details here: {{portal_url}}/families

The Switchboard team'
 where key = 'clinician_allocated' and channel = 'email';

update public.message_templates set body =
'Hi {{clinician_first_name}},

Thanks for your time on the intake call. You''re now set up to receive clients through Perch.

When we match you with a family, we''ll email you and they''ll book a free intro call in your available times. Keep those up to date here (no login needed): {{availability_url}}

The Switchboard team'
 where key = 'clinician_ready' and channel = 'email';

insert into public.message_templates (key, channel, subject, body, description) values
('availability_link', 'email', 'Your Perch availability link',
'Hi {{clinician_first_name}},

Here''s your private link to set the times families can book intro calls with you, and any days off (no login needed):
{{availability_url}}

Keep it private: anyone with the link can change your hours. Any earlier link no longer works.

The Switchboard team', 'Clinician: their availability link (sent or reset by staff)'),

('booking_confirmed', 'email', 'Booked: your {{call_label}} on {{starts_at_local}}',
'Hi {{recipient_first_name}},

Your {{call_label}} with {{host_first_name}} is booked for {{starts_at_local}} ({{minutes}} minutes). We''ll call you on your mobile at that time.

Need to change or cancel it? {{booking_url}}

The Switchboard team', 'Family or clinician: their call is booked'),

('booking_moved', 'email', 'Moved: your {{call_label}} is now {{starts_at_local}}',
'Hi {{recipient_first_name}},

Your {{call_label}} with {{host_first_name}} has moved to {{starts_at_local}} ({{minutes}} minutes).

Need to change it again? {{booking_url}}

The Switchboard team', 'Family or clinician: their call was moved'),

('booking_cancelled', 'email', 'Cancelled: your {{call_label}}',
'Hi {{recipient_first_name}},

Your {{call_label}} on {{starts_at_local}} has been cancelled.

You can book a new time here: {{booking_url}}

The Switchboard team', 'Family or clinician: their call was cancelled'),

('booking_host', 'email', 'New {{call_label}}: {{subject_name}}, {{starts_at_local}}',
'Hi {{recipient_first_name}},

{{subject_name}} has booked a {{call_label}} with you for {{starts_at_local}} ({{minutes}} minutes).
{{host_contact_line}}
{{record_url}}

The Switchboard team', 'Host: a call was booked with them'),

('booking_moved_host', 'email', 'Moved: {{call_label}} with {{subject_name}} is now {{starts_at_local}}',
'Hi {{recipient_first_name}},

{{subject_name}} has moved their {{call_label}} with you to {{starts_at_local}}.
{{host_contact_line}}
{{record_url}}

The Switchboard team', 'Host: a call with them was moved'),

('booking_cancelled_host', 'email', 'Cancelled: {{call_label}} with {{subject_name}}',
'Hi {{recipient_first_name}},

The {{call_label}} with {{subject_name}} on {{starts_at_local}} has been cancelled.

{{record_url}}

The Switchboard team', 'Host: a call with them was cancelled')
on conflict (key, channel) do nothing;
