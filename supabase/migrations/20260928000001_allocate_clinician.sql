-- Staff allocate a clinician directly, replacing the shortlist → offer → accept flow in the app.
-- (The offer functions stay in place, unused, so existing records still make sense.)
--
-- Allocating (or changing) the clinician:
--   * withdraws any other live match for the child (a changed clinician is told, and gets the capacity back),
--   * records the new match as accepted and takes one place from the clinician's capacity,
--   * moves the family to Matched ("accepted"),
--   * emails the family the clinician's intro-call link, and tells the clinician to expect them.

create or replace function private.family_transition_allowed(p_from public.family_status, p_to public.family_status)
returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'new'            then p_to in ('contacted', 'intake_booked', 'intake_done', 'lost', 'not_suitable', 'withdrawn')
    when 'contacted'      then p_to in ('intake_booked', 'intake_done', 'lost', 'not_suitable', 'withdrawn')
    when 'intake_booked'  then p_to in ('intake_done', 'contacted', 'lost', 'not_suitable', 'withdrawn')
    when 'intake_done'    then p_to in ('ready_to_match', 'contacted', 'not_suitable', 'lost', 'withdrawn')
    when 'ready_to_match' then p_to in ('offered', 'accepted', 'waitlist', 'lost', 'withdrawn')
    when 'offered'        then p_to in ('accepted', 'ready_to_match', 'waitlist', 'lost', 'withdrawn')
    when 'accepted'       then p_to in ('intro_booked', 'intro_done', 'converted', 'ready_to_match', 'lost', 'withdrawn')
    when 'intro_booked'   then p_to in ('intro_done', 'converted', 'accepted', 'ready_to_match', 'lost', 'withdrawn')
    when 'intro_done'     then p_to in ('converted', 'accepted', 'ready_to_match', 'lost', 'withdrawn')
    when 'waitlist'       then p_to in ('ready_to_match', 'offered', 'accepted', 'lost', 'not_suitable', 'withdrawn')
    when 'lost'           then p_to in ('contacted')
    when 'not_suitable'   then p_to in ('contacted')
    when 'withdrawn'      then p_to in ('contacted')
    when 'converted'      then false
  end
$$;

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
  if c.calcom_intro_url is null then
    raise exception '% has no intro-call booking link yet: add it to their profile first', c.name using errcode = 'P0001';
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
                       'child_first_name', v_child.first_name, 'calcom_intro_url', c.calcom_intro_url));
  perform private.notify_clinician('clinician_allocated', c.id,
    jsonb_build_object('match_id', v_match, 'family_id', f.id, 'child_first_name', v_child.first_name,
                       'child_age', private.age_years(v_child.dob, v_child.age_years), 'suburb', f.suburb,
                       'parent_name', f.parent_name));
  return v_match;
end $$;

revoke execute on function public.allocate_clinician(uuid, uuid) from public, anon;
grant execute on function public.allocate_clinician(uuid, uuid) to authenticated;

insert into public.message_templates (key, channel, subject, body, description) values
('clinician_allocated', 'email', 'New client: {{child_first_name}} ({{suburb}})',
'Hi {{clinician_first_name}},

We''ve matched you with {{child_first_name}}, a {{child_age}}-year-old in {{suburb}}. {{parent_name}} has been sent your intro-call link, so look out for their booking.

You can see their details here: {{portal_url}}/families

The Switchboard team', 'Clinician: a client has been allocated to them'),

('allocation_removed', 'email', 'Change to a client allocation',
'Hi {{clinician_first_name}},

We''ve moved {{child_first_name}} ({{suburb}}) to another clinician, so there''s nothing more you need to do for them. The place is back in your capacity.

The Switchboard team', 'Clinician: a client they were allocated has moved to another clinician')
on conflict (key, channel) do nothing;
