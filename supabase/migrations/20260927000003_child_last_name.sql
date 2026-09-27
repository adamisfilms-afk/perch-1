-- Children get a last name, so the client summary can show the child's full name.
-- Optional: families who enquired before this have only a first name.

alter table public.children
  add column last_name text check (length(last_name) between 1 and 100);

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

  insert into public.children (family_id, first_name, last_name, dob, age_years, concerns, concern_other, service_type, preferred_times)
  values (v_family, btrim(p ->> 'child_first_name'), nullif(btrim(p ->> 'child_last_name'), ''), nullif(p ->> 'dob', '')::date, nullif(p ->> 'age_years', '')::smallint,
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
     set first_name = 'Anonymised', last_name = null, dob = null,
         age_years = coalesce(age_years, private.age_years(dob, age_years)::smallint),
         notes_intake = null, concern_other = null, language = null
   where family_id = any (v_ids);
  update public.intake_calls set notes = null, answers = '{}' where family_id = any (v_ids);
  update public.message_log set recipient = 'anonymised', payload = '{}'
   where recipient_kind = 'family' and recipient_id = any (v_ids);
  return cardinality(v_ids);
end $$;
