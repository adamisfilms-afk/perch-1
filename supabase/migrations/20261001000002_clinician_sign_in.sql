-- Clinicians sign in to their own page with their email and a 6-digit code (no password, no Supabase login).
--
--   * request_clinician_code(email) emails a code that works once, for 10 minutes, for 5 tries.
--   * verify_clinician_code(email, code) returns a session token. The app keeps it in an httpOnly cookie
--     for 30 days, so they aren't asked again on that device.
--   * clinician_session(token) says which clinician a session belongs to. Sessions end when they expire,
--     when the clinician signs out, when staff reset their link, or when they're off-boarded.
--
-- Only hashes are stored. Referral pages (accept/decline, intro call, first session) still open from their
-- signed link in one click: they show no names or contact details.

create table public.clinician_login_codes (
  id           uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians (id) on delete cascade,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     smallint not null default 0,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index clinician_login_codes_clinician_idx on public.clinician_login_codes (clinician_id, created_at desc);

create table public.clinician_sessions (
  id           uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians (id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
create index clinician_sessions_clinician_idx on public.clinician_sessions (clinician_id);

-- Nobody reads these directly, staff included: only the functions below.
alter table public.clinician_login_codes enable row level security;
alter table public.clinician_sessions enable row level security;
revoke all on public.clinician_login_codes, public.clinician_sessions from anon, authenticated;

create or replace function private.login_code_hash(p_clinician uuid, p_code text) returns text
language sql immutable set search_path = '' as $$
  select private.hash_token(p_clinician::text || ':' || btrim(p_code))
$$;

-- Email a sign-in code. Says nothing about whether the email is known. At most 5 codes an hour per clinician.
create or replace function public.request_clinician_code(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  v_code text;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where lower(email) = lower(btrim(p_email)) and status <> 'offboarded';
  if not found then
    return;
  end if;
  if (select count(*) from public.clinician_login_codes where clinician_id = c.id and created_at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  -- 6 digits from a v4 UUID (122 random bits from the system's secure random source)
  v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
  update public.clinician_login_codes set used_at = now() where clinician_id = c.id and used_at is null;
  insert into public.clinician_login_codes (clinician_id, code_hash, expires_at)
  values (c.id, private.login_code_hash(c.id, v_code), now() + interval '10 minutes');
  perform private.notify_clinician('clinician_login_code', c.id, jsonb_build_object('code', v_code));
end $$;

-- Check a code and start a 30-day session. Returns the session token (only its hash is stored).
create or replace function public.verify_clinician_code(p_email text, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinicians;
  lc public.clinician_login_codes;
  v_token text;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.clinicians where lower(email) = lower(btrim(p_email)) and status <> 'offboarded';
  if found then
    select * into lc from public.clinician_login_codes
     where clinician_id = c.id and used_at is null and expires_at > now()
     order by created_at desc limit 1 for update;
  end if;
  if lc.id is null or lc.attempts >= 5 then
    raise exception 'That code has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  if lc.code_hash <> private.login_code_hash(c.id, p_code) then
    update public.clinician_login_codes set attempts = attempts + 1 where id = lc.id;
    return null;  -- wrong code (the attempt is counted)
  end if;
  update public.clinician_login_codes set used_at = now() where id = lc.id;
  v_token := private.new_token();
  insert into public.clinician_sessions (clinician_id, token_hash, expires_at)
  values (c.id, private.hash_token(v_token), now() + interval '30 days');
  return v_token;
end $$;

-- Which clinician a session belongs to, or null.
create or replace function public.clinician_session(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.clinician_sessions;
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select cs.* into s from public.clinician_sessions cs join public.clinicians c on c.id = cs.clinician_id
   where cs.token_hash = private.hash_token(p_token) and cs.revoked_at is null and cs.expires_at > now()
     and c.status <> 'offboarded';
  if not found then
    return null;
  end if;
  if s.last_seen_at < now() - interval '1 hour' then
    update public.clinician_sessions set last_seen_at = now() where id = s.id;
  end if;
  return s.clinician_id;
end $$;

create or replace function public.end_clinician_session(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.clinician_sessions set revoked_at = now() where token_hash = private.hash_token(p_token) and revoked_at is null;
end $$;

-- Staff resetting a clinician's link also signs them out everywhere.
create or replace function public.send_clinician_link(p_clinician uuid, p_reset boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_reset then
    update public.clinicians set link_version = link_version + 1 where id = p_clinician;
    update public.clinician_sessions set revoked_at = now() where clinician_id = p_clinician and revoked_at is null;
  end if;
  perform private.notify_clinician('clinician_link', p_clinician, '{}');
end $$;

revoke execute on function
  public.request_clinician_code(text),
  public.verify_clinician_code(text, text),
  public.clinician_session(text),
  public.end_clinician_session(text)
from public, anon, authenticated;
grant execute on function
  public.request_clinician_code(text),
  public.verify_clinician_code(text, text),
  public.clinician_session(text),
  public.end_clinician_session(text)
to service_role;

insert into public.message_templates (key, channel, subject, body, description) values
('clinician_login_code', 'email', 'Your Perch sign-in code: {{code}}',
'Hi {{clinician_first_name}},

Your code to open your Perch page is {{code}}

It works once, for the next 10 minutes. If you didn''t ask for it, you can ignore this email.

The Switchboard team', 'Clinician: a 6-digit code to sign in to their page')
on conflict (key, channel) do nothing;

update public.message_templates set body =
'Hi {{clinician_first_name}},

Here''s the link to your Perch page, where you can update your profile, available times, days off and documents, and book your intake call if you haven''t yet:
{{clinician_url}}

To keep your details safe, we''ll email you a 6-digit code to sign in on each new device.

The Switchboard team'
 where key = 'clinician_link' and channel = 'email';

update public.message_templates
   set body = replace(replace(body,
     'on your own page (no login needed):', 'on your own page (we''ll email you a code to sign in):'),
     'Keep this email: the links are private to you. Lost them? Get them again at {{app_url}}/link',
     'Keep this email: the links are private to you. You can also sign in any time at {{app_url}}/clinician')
 where key = 'clinician_welcome' and channel = 'email';
