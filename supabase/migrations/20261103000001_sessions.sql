-- Session log: every session a clinician delivers to a Perch family, so Perch knows how many sessions happened.
-- It drives the payment split for private clients (later) and the fee direct-debited from clinicians for NDIS
-- clients, so it needs to be accurate:
--
--   * Clinicians log each session from the family's referral page (date and service type). Staff can too.
--     Scheduling still happens between the family and clinician; this only records what took place.
--     Logging the first session also confirms the first session (the family becomes Active).
--   * On the 1st of each month every family with an active clinician is asked to confirm last month's count
--     ("we have 4 sessions with Priya in October: 6, 13, 20, 27") from a link. "Not right" alerts staff.
--     Families with none logged are asked too, which catches sessions that weren't logged.
--   * A daily check flags clients whose sessions have stopped (nothing logged for 3 weeks).
--
-- Prices are placeholders until pricing is decided (service_types).

create table public.service_types (
  key             text primary key,
  label           text not null,
  minutes         smallint not null,          -- billed time (session + admin)
  session_minutes smallint not null,          -- face-to-face time
  price_cents     integer not null check (price_cents >= 0),
  active          boolean not null default true,
  sort            smallint not null default 0
);
insert into public.service_types (key, label, minutes, session_minutes, price_cents, sort) values
  ('standard_45', '45 minutes (30-minute session + 15 minutes admin)', 45, 30, 14549, 1),
  ('standard_60', '60 minutes (45-minute session + 15 minutes admin)', 60, 45, 19399, 2);

create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  clinician_id  uuid not null references public.clinicians (id) on delete cascade,
  session_date  date not null,
  service_type  text not null references public.service_types (key),
  price_cents   integer not null,                -- the price when it was logged
  funding_type  public.funding_type not null,    -- the family's funding when it was logged
  status        text not null default 'logged' check (status in ('logged', 'voided')),
  void_reason   text check (length(void_reason) <= 500),
  voided_at     timestamptz,
  logged_by     text not null check (logged_by in ('clinician', 'staff')),
  logged_by_id  uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- one session per client per day (catches double entries; void the first to correct it)
create unique index sessions_one_per_day on public.sessions (match_id, session_date) where status = 'logged';
create index sessions_family_idx on public.sessions (family_id, session_date);
create index sessions_clinician_idx on public.sessions (clinician_id, session_date);
create trigger sessions_touch before update on public.sessions for each row execute function private.touch_updated_at();

create table public.session_confirmations (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  clinician_id  uuid not null references public.clinicians (id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  session_count integer not null,
  session_dates date[] not null default '{}',
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed')),
  note          text check (length(note) <= 1000),
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (match_id, month)
);
create index session_confirmations_family_idx on public.session_confirmations (family_id, month);

alter table public.matches add column session_gap_alerted_at timestamptz;

alter table public.service_types enable row level security;
alter table public.sessions enable row level security;
alter table public.session_confirmations enable row level security;
create policy service_types_staff on public.service_types for select to authenticated using ((select private.is_staff()));
create policy sessions_staff on public.sessions for select to authenticated using ((select private.is_staff()));
create policy session_confirmations_staff on public.session_confirmations for select to authenticated using ((select private.is_staff()));
revoke insert, update, delete on public.service_types, public.sessions, public.session_confirmations from anon, authenticated;
grant select on public.service_types to service_role;

-- ---------------------------------------------------------------------------
-- Logging and voiding sessions
-- ---------------------------------------------------------------------------

-- Log a session. From the clinician's referral link (service role) or by staff.
create or replace function public.log_session(p_match uuid, p_date date, p_service_type text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  f public.families;
  st public.service_types;
  v_staff boolean := private.is_staff();
  v_max_days integer := case when private.is_staff() then 365 else 90 end;  -- how far back a session can be logged
  v_id uuid;
begin
  if not (v_staff or private.is_service()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into m from public.matches where id = p_match for update;
  if not found or m.state <> 'accepted' then
    raise exception 'This client isn''t allocated to this clinician any more' using errcode = 'P0001';
  end if;
  select * into st from public.service_types where key = p_service_type and active;
  if not found then
    raise exception 'Choose the type of session' using errcode = 'P0001';
  end if;
  if p_date is null or p_date > private.today() then
    raise exception 'Sessions can only be logged on or after the day they happen' using errcode = 'P0001';
  end if;
  if p_date < private.today() - v_max_days then
    raise exception 'That date is too long ago to log here. Ask the Perch team to add it.' using errcode = 'P0001';
  end if;
  select * into f from public.families where id = m.family_id;

  insert into public.sessions (match_id, family_id, clinician_id, session_date, service_type, price_cents, funding_type,
                               logged_by, logged_by_id)
  values (m.id, m.family_id, m.clinician_id, p_date, st.key, st.price_cents, f.funding_type,
          case when v_staff then 'staff' else 'clinician' end, case when v_staff then auth.uid() end)
  returning id into v_id;

  -- the first session logged confirms the first session
  if not exists (select 1 from public.conversions where match_id = m.id) then
    perform private.confirm_first_session_core(m.id, p_date, auth.uid());
  end if;
  update public.matches set session_gap_alerted_at = null where id = m.id;
  return v_id;
exception
  when unique_violation then
    raise exception 'A session on % is already logged for this client', to_char(p_date, 'FMDD Mon YYYY') using errcode = 'P0001';
end $$;

-- Void a session logged by mistake. Staff any time; the clinician (service role) only their own, and only
-- until the family has confirmed that month.
create or replace function public.void_session(p_session uuid, p_reason text, p_clinician uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found or s.status <> 'logged' then
    raise exception 'That session isn''t logged' using errcode = 'P0001';
  end if;
  if not private.is_staff() then
    if not private.is_service() or s.clinician_id is distinct from p_clinician then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    if exists (select 1 from public.session_confirmations sc
                where sc.match_id = s.match_id and sc.month = date_trunc('month', s.session_date)::date and sc.status = 'confirmed') then
      raise exception 'The family has already confirmed that month. Ask the Perch team to correct it.' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Add a short reason' using errcode = 'P0001';
  end if;
  update public.sessions set status = 'voided', void_reason = btrim(p_reason), voided_at = now() where id = s.id;
end $$;

-- ---------------------------------------------------------------------------
-- Monthly confirmation by the family, and the gap check
-- ---------------------------------------------------------------------------

-- Ask each family with an active clinician to confirm the sessions logged in p_month (the 1st of a month).
-- Families with none logged are asked too. Once per family, clinician and month.
create or replace function private.send_session_confirmations(p_month date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id uuid;
  v_sent integer := 0;
  v_end date := (p_month + interval '1 month')::date;
begin
  for r in
    select m.id as match_id, m.family_id, m.clinician_id, c.name as clinician_name,
           coalesce(array_agg(s.session_date order by s.session_date) filter (where s.id is not null), '{}') as dates
      from public.matches m
      join public.conversions cv on cv.match_id = m.id and cv.first_session_at < v_end
      join public.clinicians c on c.id = m.clinician_id
      join public.families f on f.id = m.family_id and f.anonymised_at is null
      left join public.sessions s on s.match_id = m.id and s.status = 'logged'
                                  and s.session_date >= p_month and s.session_date < v_end
     where m.state = 'accepted'
     group by m.id, m.family_id, m.clinician_id, c.name
  loop
    insert into public.session_confirmations (match_id, family_id, clinician_id, month, session_count, session_dates)
    values (r.match_id, r.family_id, r.clinician_id, p_month, cardinality(r.dates), r.dates)
    on conflict (match_id, month) do nothing
    returning id into v_id;
    continue when v_id is null;
    perform private.notify_family('sessions_monthly_check', r.family_id,
      jsonb_build_object('confirmation_id', v_id, 'clinician_name', r.clinician_name,
                         'clinician_first_name', split_part(r.clinician_name, ' ', 1),
                         'month_label', to_char(p_month, 'FMMonth'),
                         'session_count', cardinality(r.dates),
                         'session_dates_label', coalesce(nullif(array_to_string(array(select to_char(d, 'FMDD') from unnest(r.dates) d), ', '), ''), 'none')),
      array['sms', 'email']::public.message_channel[]);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

-- The family answers from their link (server only).
create or replace function public.respond_session_confirmation(p_id uuid, p_confirmed boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sc public.session_confirmations;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into sc from public.session_confirmations where id = p_id for update;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not p_confirmed and coalesce(btrim(p_note), '') = '' then
    raise exception 'Tell us what''s different, for example how many sessions you had' using errcode = 'P0001';
  end if;
  update public.session_confirmations
     set status = case when p_confirmed then 'confirmed' else 'disputed' end,
         note = nullif(btrim(p_note), ''), responded_at = now()
   where id = sc.id;
  if not p_confirmed then
    perform private.notify_staff('sessions_disputed',
      jsonb_build_object('family_id', sc.family_id, 'clinician_name', (select name from public.clinicians where id = sc.clinician_id),
                         'month_label', to_char(sc.month, 'FMMonth YYYY'), 'session_count', sc.session_count,
                         'reason', btrim(p_note)));
  end if;
end $$;

-- Daily: monthly confirmations on the 1st, and clients whose sessions have stopped (nothing for 3 weeks).
create or replace function private.run_session_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today();
  v_gap integer := coalesce(private.setting_int('session_gap_days'), 21);
  v_confirmations integer := 0;
  v_gaps integer := 0;
  r record;
begin
  if extract(day from v_today) = 1 then
    v_confirmations := private.send_session_confirmations((date_trunc('month', v_today) - interval '1 month')::date);
  end if;

  for r in
    select m.id, m.family_id, c.name as clinician_name,
           greatest(cv.first_session_at, (select max(s.session_date) from public.sessions s where s.match_id = m.id and s.status = 'logged')) as last_session
      from public.matches m
      join public.conversions cv on cv.match_id = m.id
      join public.clinicians c on c.id = m.clinician_id
      join public.families f on f.id = m.family_id and f.status = 'converted'
     where m.state = 'accepted' and m.session_gap_alerted_at is null
     for update of m skip locked
  loop
    continue when r.last_session is null or r.last_session > v_today - v_gap;
    update public.matches set session_gap_alerted_at = now() where id = r.id;
    perform private.notify_staff('session_gap',
      jsonb_build_object('family_id', r.family_id, 'clinician_name', r.clinician_name,
                         'days', v_today - r.last_session, 'last_session_label', to_char(r.last_session, 'FMDD Mon YYYY')));
    v_gaps := v_gaps + 1;
  end loop;

  return jsonb_build_object('confirmations', v_confirmations, 'gap_alerts', v_gaps);
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
    when 'sessions' then private.run_session_jobs()
    when 'retention' then jsonb_build_object('anonymised', private.anonymise_stale_families())
  end;
end $$;

insert into public.settings (key, value, description) values
  ('session_gap_days', '21', 'Alert staff when an active client has had no session logged for this many days')
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 20:15 UTC = 6:15am (AEST) / 7:15am (AEDT) in Sydney
    perform cron.schedule('switchboard-sessions', '15 20 * * *', 'select private.run_session_jobs()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create or replace function private.log_session_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := (select label from public.service_types where key = new.service_type);
  v_summary text;
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'session_logged';
    v_summary := 'Session logged: ' || to_char(new.session_date, 'Dy FMDD Mon YYYY') || ', ' || coalesce(v_label, new.service_type);
  elsif new.status = 'voided' and old.status <> 'voided' then
    v_kind := 'session_voided';
    v_summary := 'Session on ' || to_char(new.session_date, 'FMDD Mon YYYY') || ' removed (' || coalesce(new.void_reason, 'no reason') || ')';
  else
    return null;
  end if;
  perform private.log_event('family', new.family_id, v_kind, v_summary,
    jsonb_build_object('session_id', new.id, 'match_id', new.match_id, 'date', new.session_date, 'service_type', new.service_type));
  perform private.log_event('clinician', new.clinician_id, v_kind, v_summary,
    jsonb_build_object('session_id', new.id, 'match_id', new.match_id, 'date', new.session_date, 'service_type', new.service_type));
  return null;
end $$;
create trigger sessions_activity after insert or update on public.sessions
  for each row execute function private.log_session_change();

create or replace function private.log_session_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_month text := to_char(new.month, 'FMMonth YYYY');
begin
  if tg_op = 'INSERT' then
    perform private.log_event('family', new.family_id, 'sessions_check_sent',
      'Asked to confirm ' || new.session_count || ' session' || case when new.session_count = 1 then '' else 's' end || ' in ' || v_month,
      jsonb_build_object('confirmation_id', new.id));
  elsif new.status <> old.status then
    perform private.log_event('family', new.family_id, 'sessions_' || new.status,
      case new.status when 'confirmed' then 'Confirmed ' else 'Said this isn''t right: ' end
        || new.session_count || ' session' || case when new.session_count = 1 then '' else 's' end || ' in ' || v_month
        || coalesce(' (' || new.note || ')', ''),
      jsonb_build_object('confirmation_id', new.id, 'note', new.note));
    perform private.log_event('clinician', new.clinician_id, 'sessions_' || new.status,
      'Family ' || case new.status when 'confirmed' then 'confirmed ' else 'disputed ' end
        || new.session_count || ' session' || case when new.session_count = 1 then '' else 's' end || ' in ' || v_month,
      jsonb_build_object('confirmation_id', new.id));
  end if;
  return null;
end $$;
create trigger session_confirmations_activity after insert or update on public.session_confirmations
  for each row execute function private.log_session_confirmation();

-- ---------------------------------------------------------------------------
-- Grants and messages
-- ---------------------------------------------------------------------------

revoke execute on function
  public.log_session(uuid, date, text),
  public.void_session(uuid, text, uuid),
  public.respond_session_confirmation(uuid, boolean, text)
from public, anon;
revoke execute on function public.respond_session_confirmation(uuid, boolean, text) from authenticated;
grant execute on function public.log_session(uuid, date, text), public.void_session(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.respond_session_confirmation(uuid, boolean, text) to service_role;

insert into public.message_templates (key, channel, subject, body, description) values
('sessions_monthly_check', 'sms', null,
'Perch: we have {{session_count}} session(s) with {{clinician_first_name}} in {{month_label}} ({{session_dates_label}}). Is that right? {{confirm_url}}',
'Family: confirm last month''s sessions'),

('sessions_monthly_check', 'email', 'Your sessions with {{clinician_first_name}} in {{month_label}}',
'Hi {{parent_first_name}},

We have {{session_count}} session(s) with {{clinician_name}} recorded for {{month_label}} (dates: {{session_dates_label}}).

Is that right? It takes one click: {{confirm_url}}

Thanks for helping us keep our records accurate.

The Switchboard team', 'Family: confirm last month''s sessions'),

('sessions_disputed', 'email', 'Session count queried: {{clinician_name}}, {{month_label}}',
'A family says the {{session_count}} session(s) recorded with {{clinician_name}} for {{month_label}} isn''t right: "{{reason}}". {{app_url}}/families/{{family_id}}?tab=bookings',
'Staff: a family disputed their monthly session count'),

('sessions_disputed', 'slack', null,
':warning: Session count queried for {{clinician_name}}, {{month_label}}: "{{reason}}". {{app_url}}/families/{{family_id}}?tab=bookings',
'Staff: a family disputed their monthly session count'),

('session_gap', 'email', 'No sessions logged for {{days}} days: {{clinician_name}}',
'A client of {{clinician_name}} has had no session logged since {{last_session_label}} ({{days}} days). Check in with the clinician and the family: {{app_url}}/families/{{family_id}}?tab=bookings',
'Staff: an active client''s sessions have stopped'),

('session_gap', 'slack', null,
':hourglass_flowing_sand: No sessions logged for {{days}} days for a client of {{clinician_name}} (last {{last_session_label}}). {{app_url}}/families/{{family_id}}?tab=bookings',
'Staff: an active client''s sessions have stopped')
on conflict (key, channel) do nothing;

-- ---------------------------------------------------------------------------
-- Deleting a client or clinician (admins only, from the record's danger zone)
-- ---------------------------------------------------------------------------
-- Removes the record and everything that belongs to it (children, consents, calls, referrals, bookings, documents…)
-- and the messages sent to them. Refused once sessions are logged or fee statements exist: those are financial
-- records to keep, so anonymise instead. The activity log keeps a note of the deletion and who did it.

create or replace function public.delete_family(p_family uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.families;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can delete a client' using errcode = '42501';
  end if;
  select * into f from public.families where id = p_family for update;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sessions where family_id = f.id and status = 'logged') then
    raise exception 'This client has sessions logged, which are financial records. Remove their personal details instead.' using errcode = 'P0001';
  end if;
  perform private.log_event('family', f.id, 'deleted', 'Client deleted');
  delete from public.message_log where recipient_kind = 'family' and recipient_id = f.id;
  delete from public.families where id = f.id;
end $$;

-- Returns the stored document files, for the app to remove from storage.
create or replace function public.delete_clinician(p_clinician uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  v_files text[];
  r record;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can delete a clinician' using errcode = '42501';
  end if;
  select * into c from public.clinicians where id = p_clinician for update;
  if not found then
    raise exception 'Clinician not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sessions where clinician_id = c.id and status = 'logged')
     or exists (select 1 from public.fee_statements where clinician_id = c.id) then
    raise exception 'This clinician has sessions or fee statements, which are financial records. Off-board them instead.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches m join public.families f on f.id = m.family_id
              where m.clinician_id = c.id and m.state = 'accepted' and f.status = 'converted') then
    raise exception 'This clinician is seeing clients. Move them to another clinician, or off-board them instead.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(file_path) filter (where file_path is not null), '{}') into v_files
    from public.credentials where clinician_id = c.id;
  -- clients offered to or matched with them go back to Ready to match (their referral is removed with the clinician)
  for r in
    select m.family_id from public.matches m join public.families f on f.id = m.family_id
     where m.clinician_id = c.id and m.state in ('offered', 'accepted') and f.status in ('offered', 'accepted', 'intro_booked', 'intro_done')
  loop
    perform private.set_family_status(r.family_id, 'ready_to_match', 'Clinician deleted');
  end loop;
  perform private.log_event('clinician', c.id, 'deleted', 'Clinician deleted');
  delete from public.message_log where recipient_kind = 'clinician' and recipient_id = c.id;
  delete from public.clinicians where id = c.id;
  return v_files;
end $$;

revoke execute on function public.delete_family(uuid), public.delete_clinician(uuid) from public, anon;
grant execute on function public.delete_family(uuid), public.delete_clinician(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Records staff add from Switchboard (the "New contact" and "New clinician" pop-ups) go through the same
-- server-only functions as the public forms; the app says which staff member it acts for.
-- ---------------------------------------------------------------------------

create or replace function private.log_event(p_entity_type text, p_entity_id uuid, p_kind text, p_summary text,
  p_detail jsonb default '{}', p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_actor text;
  v_headers json;
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
        v_headers := nullif(current_setting('request.headers', true), '')::json;
        v_actor := v_headers ->> 'x-perch-actor';
        -- a staff member acting through a server-only function (the app sets both headers)
        if v_actor = 'staff' then
          v_uid := (v_headers ->> 'x-perch-actor-id')::uuid;
          if not exists (select 1 from public.profiles where id = v_uid and role <> 'clinician') then
            v_uid := null;
            v_actor := null;
          end if;
        end if;
      exception when others then
        v_actor := null;
        v_uid := null;
      end;
    end if;
    if v_actor is null or v_actor not in ('clinician', 'family', 'staff') then
      v_actor := 'system';
    end if;
  end if;
  insert into public.activity_log (entity_type, entity_id, at, kind, summary, detail, actor_kind, actor_id)
  values (p_entity_type, p_entity_id, coalesce(p_at, now()), p_kind, p_summary, coalesce(p_detail, '{}'),
          v_actor, case when v_actor = 'staff' then v_uid end);
end $$;
