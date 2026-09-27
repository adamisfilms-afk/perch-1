-- Call the app's /api/cron/tick every 5 minutes from Supabase, so queued emails and SMS
-- (offer nudges, reminders, follow-ups) go out promptly. Vercel's Hobby plan only allows
-- daily cron jobs, so vercel.json keeps just the daily one.
--
-- Needs two secrets in Supabase Vault (Dashboard → Integrations → Vault):
--   switchboard_app_url      e.g. https://your-site.vercel.app
--   switchboard_cron_secret  the same value as CRON_SECRET in Vercel
-- Until both exist the job does nothing. Skipped where pg_cron / pg_net aren't available (e.g. CI).

create or replace function private.ping_app_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'switchboard_app_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'switchboard_cron_secret'$q$ into v_secret;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 55000)'
    using rtrim(v_url, '/') || '/api/cron/tick',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret);
end;
$$;

revoke execute on function private.ping_app_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('switchboard-app-tick', '*/5 * * * *', 'select private.ping_app_tick()');
  end if;
end $$;
