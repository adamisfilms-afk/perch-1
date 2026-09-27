-- The Switchboard: row-level security
--
-- Rules of thumb
--   * Staff (admin, coordinator, clinical lead) see operational data. Finance and the audit log are admin-only.
--   * Clinicians see their own records. They see a family only after accepting that family's referral;
--     before that they get the de-identified summary from get_my_offers().
--   * The public (anon) role has no table access at all. Public forms go through the server.
--   * Every role check also requires multi-factor login (see private.mfa_satisfied).

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant usage on schema private to authenticated, service_role;

-- helpers that policies, views and caller-rights triggers need
grant execute on function
  private.today(), private.setting(text), private.setting_int(text), private.setting_text(text),
  private.request_ip(), private.age_years(date, smallint), private.is_service(),
  private.mfa_satisfied(), private.current_app_role(), private.is_staff(), private.is_admin(),
  private.can_approve_complex(), private.current_clinician_id(),
  private.family_transition_allowed(public.family_status, public.family_status),
  private.clinician_transition_allowed(public.clinician_status, public.clinician_status),
  private.required_credential_types(public.profession, boolean),
  private.credential_gaps(uuid, public.profession, boolean),
  private.go_live_gaps(public.clinicians)
to authenticated, service_role;

-- RPCs for signed-in users (each checks the caller's role itself)
grant execute on function
  public.log_access(text, uuid, text),
  public.set_family_status(uuid, public.family_status, text),
  public.clinician_go_live_gaps(uuid),
  public.set_clinician_status(uuid, public.clinician_status, public.pause_reason, text),
  public.approve_clinician(uuid),
  public.verify_credential(uuid, boolean, text, date),
  public.record_sighted_credential(uuid, public.credential_type, date, date, text, text),
  public.record_abn_check(uuid, text, boolean, text),
  public.propose_shortlist(uuid, jsonb),
  public.approve_shortlist(uuid),
  public.respond_to_offer(uuid, boolean, text),
  public.withdraw_offer(uuid, text),
  public.record_intro_outcome(uuid, public.intro_outcome, text),
  public.confirm_first_session(uuid, date),
  public.get_my_offers(),
  public.complete_intake(uuid, public.intake_outcome, jsonb, text, text),
  public.set_waitlist(uuid, text, text[]),
  public.set_my_preferences(boolean),
  public.run_scheduled_jobs(text)          -- admins can run jobs by hand from Settings
to authenticated;

-- server-only RPCs: public forms, webhooks, one-click links, scheduled jobs
grant execute on function
  public.submit_enquiry(jsonb),
  public.submit_application(jsonb),
  public.record_booking(text, uuid, text, timestamptz, text, boolean),
  public.record_agreement_signed(text, timestamptz),
  public.confirm_first_session_by_token(text, date),
  public.peek_action_token(text),
  public.check_rate_limit(text, integer, integer),
  public.record_abn_check(uuid, text, boolean, text),
  public.run_scheduled_jobs(text)
to service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.families enable row level security;
alter table public.children enable row level security;
alter table public.consents enable row level security;
alter table public.intake_calls enable row level security;
alter table public.clinicians enable row level security;
alter table public.availability enable row level security;
alter table public.credentials enable row level security;
alter table public.credential_reminders enable row level security;
alter table public.agreements enable row level security;
alter table public.offboarding_checklists enable row level security;
alter table public.matches enable row level security;
alter table public.intro_calls enable row level security;
alter table public.conversions enable row level security;
alter table public.fee_statements enable row level security;
alter table public.status_history enable row level security;
alter table public.audit_log enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_log enable row level security;
alter table public.action_tokens enable row level security;
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_admin_write on public.profiles for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- settings and message templates: staff read, admin write
create policy settings_select on public.settings for select to authenticated using ((select private.is_staff()));
create policy settings_admin on public.settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy templates_select on public.message_templates for select to authenticated using ((select private.is_staff()));
create policy templates_admin on public.message_templates for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- families: staff, or the clinician who accepted the referral
create policy families_staff on public.families for select to authenticated using ((select private.is_staff()));
create policy families_staff_insert on public.families for insert to authenticated with check ((select private.is_staff()));
create policy families_staff_update on public.families for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy families_admin_delete on public.families for delete to authenticated using ((select private.is_admin()));
create policy families_accepted_clinician on public.families for select to authenticated
  using (exists (select 1 from public.matches m
                  where m.family_id = families.id and m.state = 'accepted'
                    and m.clinician_id = (select private.current_clinician_id())));

create policy children_staff on public.children for select to authenticated using ((select private.is_staff()));
create policy children_staff_insert on public.children for insert to authenticated with check ((select private.is_staff()));
create policy children_staff_update on public.children for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy children_admin_delete on public.children for delete to authenticated using ((select private.is_admin()));
create policy children_accepted_clinician on public.children for select to authenticated
  using (exists (select 1 from public.matches m
                  where m.child_id = children.id and m.state = 'accepted'
                    and m.clinician_id = (select private.current_clinician_id())));

create policy consents_staff on public.consents for select to authenticated using ((select private.is_staff()));
create policy consents_staff_write on public.consents for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy intake_staff on public.intake_calls for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- clinicians
create policy clinicians_staff on public.clinicians for select to authenticated using ((select private.is_staff()));
create policy clinicians_staff_insert on public.clinicians for insert to authenticated with check ((select private.is_staff()));
create policy clinicians_staff_update on public.clinicians for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy clinicians_admin_delete on public.clinicians for delete to authenticated using ((select private.is_admin()));
create policy clinicians_self_select on public.clinicians for select to authenticated
  using (id = (select private.current_clinician_id()));
create policy clinicians_self_update on public.clinicians for update to authenticated
  using (id = (select private.current_clinician_id())) with check (id = (select private.current_clinician_id()));

create policy availability_staff on public.availability for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy availability_self on public.availability for all to authenticated
  using (clinician_id = (select private.current_clinician_id()))
  with check (clinician_id = (select private.current_clinician_id()));

-- credentials: clinicians upload and see their own; only staff verify
create policy credentials_staff on public.credentials for select to authenticated using ((select private.is_staff()));
create policy credentials_staff_insert on public.credentials for insert to authenticated with check ((select private.is_staff()));
create policy credentials_staff_update on public.credentials for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy credentials_self_select on public.credentials for select to authenticated
  using (clinician_id = (select private.current_clinician_id()));
create policy credentials_self_insert on public.credentials for insert to authenticated
  with check (clinician_id = (select private.current_clinician_id()) and status = 'pending');

create policy credential_reminders_staff on public.credential_reminders for select to authenticated
  using ((select private.is_staff()));

create policy agreements_staff on public.agreements for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy agreements_self on public.agreements for select to authenticated
  using (clinician_id = (select private.current_clinician_id()));

create policy offboarding_staff on public.offboarding_checklists for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- matches: staff see all; clinicians see only offers actually sent to them.
-- All writes go through the RPCs above.
create policy matches_staff on public.matches for select to authenticated using ((select private.is_staff()));
create policy matches_self on public.matches for select to authenticated
  using (clinician_id = (select private.current_clinician_id()) and offered_at is not null);

create policy intro_calls_staff on public.intro_calls for select to authenticated using ((select private.is_staff()));
create policy intro_calls_self on public.intro_calls for select to authenticated
  using (exists (select 1 from public.matches m where m.id = intro_calls.match_id
                  and m.clinician_id = (select private.current_clinician_id())));

create policy conversions_staff on public.conversions for select to authenticated using ((select private.is_staff()));
create policy conversions_self on public.conversions for select to authenticated
  using (exists (select 1 from public.matches m where m.id = conversions.match_id
                  and m.clinician_id = (select private.current_clinician_id())));

-- finance: admins only, plus each clinician's own statements
create policy fee_statements_admin on public.fee_statements for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy fee_statements_self on public.fee_statements for select to authenticated
  using (clinician_id = (select private.current_clinician_id()) and status <> 'draft');

create policy status_history_staff on public.status_history for select to authenticated using ((select private.is_staff()));

create policy audit_log_admin on public.audit_log for select to authenticated using ((select private.is_admin()));

create policy message_log_staff on public.message_log for select to authenticated using ((select private.is_staff()));

-- action_tokens and rate_limits: no policies, so only security-definer functions and the service role can touch them.

-- ---------------------------------------------------------------------------
-- File storage: private bucket, one folder per clinician (<clinician_id>/<file>)
-- Files are only ever opened through short-lived signed URLs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('credentials', 'credentials', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;

create policy credential_files_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'credentials' and (select private.is_staff()));
create policy credential_files_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'credentials' and (select private.is_staff()));
create policy credential_files_self_read on storage.objects for select to authenticated
  using (bucket_id = 'credentials'
         and (storage.foldername(name))[1] = (select private.current_clinician_id())::text);
create policy credential_files_self_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'credentials'
              and (storage.foldername(name))[1] = (select private.current_clinician_id())::text);

grant execute on function public.claim_messages(integer), public.complete_message(uuid, public.message_status, text, text)
  to service_role;

-- Supabase grants EXECUTE on new public functions to every signed-in user by default.
-- Take the server-only ones back, so a logged-in clinician can't call them through the API
-- (claim_messages, for example, would hand over queued messages with contact details and tokens).
revoke execute on function
  public.submit_enquiry(jsonb),
  public.submit_application(jsonb),
  public.record_booking(text, uuid, text, timestamptz, text, boolean),
  public.record_agreement_signed(text, timestamptz),
  public.confirm_first_session_by_token(text, date),
  public.peek_action_token(text),
  public.check_rate_limit(text, integer, integer),
  public.claim_messages(integer),
  public.complete_message(uuid, public.message_status, text, text)
from authenticated;
