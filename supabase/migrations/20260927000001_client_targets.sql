-- Client summary targets.
-- Time targets between onboarding steps stay in stale_limits_hours (they also drive the dashboard's stale alerts).
-- This adds targets for the numbers at the top of the client summary page.

insert into public.settings (key, value, description) values
  ('client_kpi_targets',
   '{"total_clients": 200, "active_rate_pct": 50, "signup_to_session_days": 7, "new_signups_7d": 10}',
   'Targets for the client summary: total clients, % of clients active, average days from sign-up to first session, and new sign-ups per 7 days')
on conflict (key) do nothing;
