-- Clinicians can book their intake call with the team straight after signing up, before they've completed
-- their profile or submitted their application. (Recording the call, which makes them Ready, still needs the
-- application submitted and the go-live gate passed.) The welcome email now includes the booking link.

-- Book a call. Server only: the app has already checked the signed link and that the time is free.
-- A clinician can book their intake call as soon as they've signed up, before their application is finished.
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
    if not found or c.status not in ('applied', 'screening') then
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

update public.message_templates set body =
'Hi {{clinician_first_name}},

Thanks for signing up to join our clinician network.

1. Book a short intake call with our team: {{screening_booking_url}}

2. Then, on your own page (no login needed): {{clinician_url}}
   - complete your profile (the ages and funding types you work with),
   - set your available times for free intro calls with families,
   - upload your documents (registration, Working with Children Check, NDIS screening, insurance and ABN),
   - accept the service agreement and submit your application.

You can do these in any order, and finish your profile before or after the call.

Keep this email: the links are private to you. Lost them? Get them again at {{app_url}}/link

The Switchboard team'
 where key = 'clinician_welcome' and channel = 'email';

update public.message_templates set subject = 'Application received', body =
'Hi {{clinician_first_name}},

Thanks for submitting your application. We''ll check your documents and let you know once you''re ready for referrals.

Haven''t booked your intake call with our team yet, or need to change it? {{screening_booking_url}}

The Switchboard team'
 where key = 'application_submitted' and channel = 'email';

update public.message_templates set body =
'Hi {{clinician_first_name}},

Here''s your private link to your Perch page, where you can update your profile, available times, days off and documents, and book your intake call if you haven''t yet (no login needed):
{{clinician_url}}

Keep it private: anyone with the link can change your details. Any earlier link no longer works if we''ve reset it.

The Switchboard team'
 where key = 'clinician_link' and channel = 'email';
