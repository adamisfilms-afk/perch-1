import "server-only";

// Clinicians have no database login. Their own page (/clinician) needs an emailed sign-in code
// (see clinician-session.ts); the signed link in their emails (/clinician/<link>) only says who they are.
// Each referral has a page (/referral/<link>) that opens from its signed link in one click. This checks those
// links and loads what the pages show, with the service role, reading only that clinician's own data.
// Family names and contact details are never shown on these pages: clinicians get them by email once they
// accept a referral.

import { clinicianPath, linkSecret, readLinkToken, referralPath } from "../booking/links";
import type { FundingType, ServiceType, TimeBlock } from "../domain";
import { env } from "../env";
import { ageFrom } from "../time";
import { createAdminClient } from "../supabase/admin";
import { firstOf, type ClinicianRow, type CredentialRow } from "../types";
import { bookingUrl, loadSettings } from "./booking";

export function clinicianUrl(clinicianId: string, version: number): string {
  return `${env.appUrl()}${clinicianPath(linkSecret(), clinicianId, version)}`;
}

export function referralUrl(matchId: string, version: number): string {
  return `${env.appUrl()}${referralPath(linkSecret(), matchId, version)}`;
}

/** The clinician a valid link belongs to, or null. Old links stop working when staff reset them. */
export async function resolveClinicianLink(token: string): Promise<{ clinicianId: string } | null> {
  const ref = readLinkToken(linkSecret(), token);
  if (!ref || ref.kind !== "clinician") return null;
  const { data } = await createAdminClient().from("clinicians").select("id, status, link_version").eq("id", ref.id).maybeSingle();
  if (!data || data.status === "offboarded" || data.link_version !== ref.version) return null;
  return { clinicianId: data.id };
}

/** The referral a valid link names, and its clinician, or null. */
export async function resolveReferralLink(token: string): Promise<{ matchId: string; clinicianId: string } | null> {
  const ref = readLinkToken(linkSecret(), token);
  if (!ref || ref.kind !== "referral") return null;
  const { data } = await createAdminClient()
    .from("matches")
    .select("id, clinician_id, clinicians(status, link_version)")
    .eq("id", ref.id)
    .maybeSingle();
  const c = firstOf(data?.clinicians as { status: string; link_version: number } | { status: string; link_version: number }[] | null);
  if (!data || !c || c.status === "offboarded" || c.link_version !== ref.version) return null;
  return { matchId: data.id, clinicianId: data.clinician_id };
}

// ---------------------------------------------------------------------------
// The clinician's page
// ---------------------------------------------------------------------------

export interface OpenReferral {
  url: string;
  childAge: number | null;
  suburb: string;
  expiresAt: string | null;
}

export interface ClinicianPageView {
  clinician: ClinicianRow;
  windows: { day: number; start: string; end: string }[];
  timeOff: { id: string; starts_on: string; ends_on: string; note: string | null }[];
  /** Times only: no family details on this page. */
  upcomingIntroCalls: string[];
  credentials: CredentialRow[];
  applicationGaps: string[];
  intakeCall: { url: string; startsAt: string | null } | null;
  openReferrals: OpenReferral[];
  activeClients: number;
  introMinutes: number;
}

export async function loadClinicianPage(clinicianId: string): Promise<ClinicianPageView | null> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const [{ data: c }, { data: windows }, { data: off }, { data: calls }, { data: creds }, { data: gaps }, { data: intake }, { data: matches }, settings] =
    await Promise.all([
      db.from("clinicians").select("*").eq("id", clinicianId).maybeSingle<ClinicianRow>(),
      db.from("availability").select("day_of_week, start_time, end_time").eq("clinician_id", clinicianId).order("day_of_week").order("start_time"),
      db.from("time_off").select("id, starts_on, ends_on, note").eq("clinician_id", clinicianId).gte("ends_on", today).order("starts_on"),
      db.from("appointments").select("starts_at").eq("host_clinician_id", clinicianId).eq("status", "booked").gte("starts_at", nowIso).order("starts_at"),
      db.from("credentials").select("*").eq("clinician_id", clinicianId).neq("status", "superseded").order("created_at", { ascending: false }),
      db.rpc("clinician_application_gaps", { p_clinician: clinicianId }),
      db.from("appointments").select("starts_at").eq("kind", "clinician_intake").eq("clinician_id", clinicianId).eq("status", "booked").maybeSingle(),
      db
        .from("matches")
        .select("id, state, offer_expires_at, families(suburb), children(dob, age_years)")
        .eq("clinician_id", clinicianId)
        .in("state", ["offered", "accepted"]),
      loadSettings(db),
    ]);
  if (!c) return null;

  type M = {
    id: string;
    state: string;
    offer_expires_at: string | null;
    families: { suburb: string } | { suburb: string }[] | null;
    children: { dob: string | null; age_years: number | null } | { dob: string | null; age_years: number | null }[] | null;
  };
  const rows = (matches ?? []) as M[];
  const onboarding = !["active", "paused"].includes(c.status);

  return {
    clinician: c,
    windows: (windows ?? []).map((w: { day_of_week: number; start_time: string; end_time: string }) => ({
      day: w.day_of_week,
      start: w.start_time.slice(0, 5),
      end: w.end_time.slice(0, 5),
    })),
    timeOff: (off ?? []) as ClinicianPageView["timeOff"],
    upcomingIntroCalls: (calls ?? []).map((a: { starts_at: string }) => a.starts_at),
    credentials: (creds ?? []) as CredentialRow[],
    applicationGaps: (gaps as string[] | null) ?? [],
    intakeCall:
      onboarding && ["applied", "screening"].includes(c.status)
        ? { url: bookingUrl("clinician_intake", c.id), startsAt: (intake as { starts_at: string } | null)?.starts_at ?? null }
        : null,
    openReferrals: rows
      .filter((m) => m.state === "offered" && (!m.offer_expires_at || m.offer_expires_at > nowIso))
      .map((m) => {
        const child = firstOf(m.children);
        return {
          url: referralUrl(m.id, c.link_version),
          childAge: child ? ageFrom(child.dob, child.age_years) : null,
          suburb: firstOf(m.families)?.suburb ?? "",
          expiresAt: m.offer_expires_at,
        };
      }),
    activeClients: rows.filter((m) => m.state === "accepted").length,
    introMinutes: settings.intro_call_minutes,
  };
}

// ---------------------------------------------------------------------------
// A referral
// ---------------------------------------------------------------------------

export interface ReferralView {
  matchId: string;
  state: string;
  clinicianFirstName: string;
  clinicianPageUrl: string;
  offerExpiresAt: string | null;
  open: boolean;
  summary: {
    childAge: number | null;
    suburb: string;
    serviceType: ServiceType;
    concerns: string[];
    concernOther: string | null;
    fundingType: FundingType;
    preferredTimes: TimeBlock[];
    language: string | null;
    telehealthOk: boolean;
  };
  introAt: string | null;
  introOutcome: string | null;
  firstSessionAt: string | null;
}

export async function loadReferral(matchId: string): Promise<ReferralView | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("matches")
    .select(
      "id, state, offer_expires_at, clinicians(name, link_version, id), families(suburb, funding_type), children(dob, age_years, service_type, concerns, concern_other, preferred_times, language, telehealth_ok), intro_calls(scheduled_at, outcome, created_at), conversions(first_session_at)",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (!data) return null;
  type Row = {
    id: string;
    state: string;
    offer_expires_at: string | null;
    clinicians: { id: string; name: string; link_version: number } | null;
    families: { suburb: string; funding_type: FundingType } | null;
    children: {
      dob: string | null;
      age_years: number | null;
      service_type: ServiceType;
      concerns: string[];
      concern_other: string | null;
      preferred_times: TimeBlock[];
      language: string | null;
      telehealth_ok: boolean;
    } | null;
    intro_calls: { scheduled_at: string | null; outcome: string | null; created_at: string }[] | null;
    conversions: { first_session_at: string } | { first_session_at: string }[] | null;
  };
  const m = data as unknown as Row;
  const clinician = firstOf(m.clinicians);
  const family = firstOf(m.families);
  const child = firstOf(m.children);
  if (!clinician || !family || !child) return null;
  const intros = [...(m.intro_calls ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const nowIso = new Date().toISOString();

  return {
    matchId: m.id,
    state: m.state,
    clinicianFirstName: clinician.name.split(" ")[0],
    clinicianPageUrl: clinicianUrl(clinician.id, clinician.link_version),
    offerExpiresAt: m.offer_expires_at,
    open: m.state === "offered" && (!m.offer_expires_at || m.offer_expires_at > nowIso),
    summary: {
      childAge: ageFrom(child.dob, child.age_years),
      suburb: family.suburb,
      serviceType: child.service_type,
      concerns: child.concerns,
      concernOther: child.concern_other,
      fundingType: family.funding_type,
      preferredTimes: child.preferred_times,
      language: child.language,
      telehealthOk: child.telehealth_ok,
    },
    introAt: intros.find((i) => i.scheduled_at)?.scheduled_at ?? null,
    introOutcome: intros.find((i) => i.outcome)?.outcome ?? null,
    firstSessionAt: firstOf(m.conversions)?.first_session_at ?? null,
  };
}
