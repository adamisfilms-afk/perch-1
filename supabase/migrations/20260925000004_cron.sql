-- Scheduled jobs (Supabase pg_cron).
-- Database-only work runs here. Sending emails and SMS, and ABN re-checks, need HTTP calls,
-- so they run from the app's /api/cron routes (see vercel.json).
-- Skipped automatically where pg_cron isn't available (e.g. plain Postgres in CI).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 20:00 UTC = 6am (AEST) / 7am (AEDT) in Sydney
    perform cron.schedule('switchboard-daily', '0 20 * * *', 'select private.run_daily_jobs()');
    perform cron.schedule('switchboard-offers', '*/10 * * * *', 'select private.run_offer_jobs()');
  end if;
end $$;
