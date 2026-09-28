import "server-only";

// Booking pages (no login). A signed link says what's being booked; this works out what the person may book,
// the free times, and makes, moves or cancels the booking through the database functions.
// Runs with the service role because nobody is signed in; it only reads what the page needs.

import { bookingPath, linkSecret, readLinkToken, type BookingLinkKind } from "../booking/links";
import { CALL_LABELS, minutesFor, parseBookingSettings, type AppointmentKind, type BookingSettings } from "../booking/settings";
import { availableSlots, pickHost, type HostSchedule, type Slot } from "../booking/slots";
import { env } from "../env";
import { createAdminClient } from "../supabase/admin";
import { firstOf } from "../types";

type Db = ReturnType<typeof createAdminClient>;

export interface BookingView {
  kind: AppointmentKind;
  refId: string;
  /** False when this call can't be booked any more (e.g. the sign-up call already happened). */
  allowed: boolean;
  blockedMessage: string | null;
  heading: string;
  intro: string;
  minutes: number;
  existing: { id: string; startsAt: string; hostName: string } | null;
  slots: { start: string; hostIds: string[] }[];
}

export function bookingUrl(kind: BookingLinkKind, id: string): string {
  return `${env.appUrl()}${bookingPath(linkSecret(), kind, id)}`;
}

export async function loadSettings(db: Db): Promise<BookingSettings> {
  const { data } = await db.from("settings").select("value").eq("key", "booking").maybeSingle();
  return parseBookingSettings(data?.value);
}

/** Weekly hours, days off and bookings for the given hosts, ready for the slot calculator. */
async function schedules(
  db: Db,
  hosts: { id: string; timezone: string }[],
  kind: "staff" | "clinician",
  skipAppointment: string | null,
): Promise<HostSchedule[]> {
  if (!hosts.length) return [];
  const ids = hosts.map((h) => h.id);
  const today = new Date().toISOString().slice(0, 10);
  const [windows, off, busy] = await Promise.all([
    kind === "staff"
      ? db.from("staff_availability").select("owner:profile_id, day_of_week, start_time, end_time").in("profile_id", ids)
      : db.from("availability").select("owner:clinician_id, day_of_week, start_time, end_time").in("clinician_id", ids),
    db
      .from("time_off")
      .select("profile_id, clinician_id, starts_on, ends_on")
      .in(kind === "staff" ? "profile_id" : "clinician_id", ids)
      .gte("ends_on", today),
    db.from("appointments").select("id, host_id, starts_at, ends_at").in("host_id", ids).eq("status", "booked").gte("ends_at", new Date().toISOString()),
  ]);
  type W = { owner: string; day_of_week: number; start_time: string; end_time: string };
  type O = { profile_id: string | null; clinician_id: string | null; starts_on: string; ends_on: string };
  type B = { id: string; host_id: string; starts_at: string; ends_at: string };
  return hosts.map((h) => ({
    hostId: h.id,
    timezone: h.timezone,
    windows: ((windows.data ?? []) as W[]).filter((w) => w.owner === h.id).map((w) => ({ day: w.day_of_week, start: w.start_time, end: w.end_time })),
    timeOff: ((off.data ?? []) as O[]).filter((o) => (o.profile_id ?? o.clinician_id) === h.id),
    busy: ((busy.data ?? []) as B[])
      .filter((b) => b.host_id === h.id && b.id !== skipAppointment)
      .map((b) => ({ start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) })),
  }));
}

async function existingBooking(db: Db, kind: AppointmentKind, column: "family_id" | "clinician_id" | "match_id", id: string) {
  const { data } = await db
    .from("appointments")
    .select("id, starts_at, host_profile:profiles(full_name), host_clinician:clinicians!appointments_host_clinician_id_fkey(name)")
    .eq("kind", kind)
    .eq(column, id)
    .eq("status", "booked")
    .maybeSingle();
  if (!data) return null;
  const d = data as unknown as { id: string; starts_at: string; host_profile: unknown; host_clinician: unknown };
  const hostName =
    (firstOf(d.host_profile as { full_name: string } | { full_name: string }[] | null)?.full_name ??
      firstOf(d.host_clinician as { name: string } | { name: string }[] | null)?.name ??
      "the Perch team");
  return { id: d.id, startsAt: d.starts_at, hostName };
}

async function teamHosts(db: Db, flag: "hosts_signup_calls" | "hosts_clinician_calls") {
  const { data } = await db.from("profiles").select("id, timezone").eq(flag, true).eq("active", true).in("role", ["admin", "coordinator", "clinical_lead"]);
  return (data ?? []) as { id: string; timezone: string }[];
}

/** Everything the booking page needs, or null if the link isn't valid. */
export async function resolveBooking(token: string): Promise<BookingView | null> {
  const ref = readLinkToken(linkSecret(), token);
  if (!ref || ref.kind === "clinician" || ref.kind === "referral") return null;
  const db = createAdminClient();
  const settings = await loadSettings(db);
  const kind = ref.kind;
  const minutes = minutesFor(kind, settings);
  const opts = { minutes, now: Date.now(), minNoticeHours: settings.min_notice_hours, horizonDays: settings.horizon_days };

  let allowed = false;
  let blockedMessage: string | null = null;
  let heading = "";
  let intro = "";
  let existing: BookingView["existing"] = null;
  let hosts: HostSchedule[] = [];

  if (kind === "signup_call") {
    const { data: f } = await db.from("families").select("id, parent_name, status, children(first_name)").eq("id", ref.id).maybeSingle();
    if (!f) return null;
    const child = firstOf(f.children as { first_name: string }[] | null)?.first_name ?? "your child";
    allowed = ["new", "contacted", "intake_booked"].includes(f.status);
    blockedMessage = allowed ? null : "Your sign-up call has already happened. We'll be in touch about the next step.";
    heading = "Book your free sign-up call";
    intro = `Hi ${f.parent_name.split(" ")[0]}. Choose a time for a ${minutes}-minute phone call with the Perch team, so we can understand what ${child} needs and find the right clinician.`;
    existing = await existingBooking(db, kind, "family_id", f.id);
    if (allowed) hosts = await schedules(db, await teamHosts(db, "hosts_signup_calls"), "staff", existing?.id ?? null);
  } else if (kind === "clinician_intake") {
    const { data: c } = await db.from("clinicians").select("id, name, status, application_submitted_at").eq("id", ref.id).maybeSingle();
    if (!c) return null;
    allowed = ["applied", "screening"].includes(c.status);
    blockedMessage = allowed ? null : "Your intake call has already happened.";
    heading = "Book your intake call";
    intro = `Hi ${c.name.split(" ")[0]}. Choose a time for a ${minutes}-minute phone call with the Perch team about joining the network.`;
    existing = await existingBooking(db, kind, "clinician_id", c.id);
    if (allowed) hosts = await schedules(db, await teamHosts(db, "hosts_clinician_calls"), "staff", existing?.id ?? null);
  } else {
    const { data: m } = await db
      .from("matches")
      .select("id, state, family_id, clinicians(id, name, timezone, status), families(parent_name, status, children(first_name))")
      .eq("id", ref.id)
      .maybeSingle();
    if (!m) return null;
    const clinician = firstOf(m.clinicians as unknown as { id: string; name: string; timezone: string; status: string } | null);
    const family = firstOf(m.families as unknown as { parent_name: string; status: string; children: { first_name: string }[] | null } | null);
    if (!clinician || !family) return null;
    const first = clinician.name.split(" ")[0];
    allowed = m.state === "accepted" && ["accepted", "intro_booked"].includes(family.status) && ["active", "paused"].includes(clinician.status);
    blockedMessage = allowed ? null : m.state !== "accepted" ? "This introduction is no longer active. We'll be in touch." : "Your intro call has already happened.";
    heading = `Book a free intro call with ${first}`;
    intro = `Hi ${family.parent_name.split(" ")[0]}. Choose a time for a ${minutes}-minute phone call with ${clinician.name}, so you can meet and make sure it feels right for ${firstOf(family.children)?.first_name ?? "your child"}.`;
    existing = await existingBooking(db, kind, "match_id", m.id);
    if (allowed) hosts = await schedules(db, [{ id: clinician.id, timezone: clinician.timezone }], "clinician", existing?.id ?? null);
  }

  const slots: Slot[] = allowed ? availableSlots(hosts, opts) : [];
  return {
    kind,
    refId: ref.id,
    allowed,
    blockedMessage,
    heading,
    intro,
    minutes,
    existing,
    slots: slots.map((s) => ({ start: new Date(s.start).toISOString(), hostIds: s.hostIds })),
  };
}

export type BookResult = { ok: true; startsAt: string } | { ok: false; error: string };

/** Book (or move) the call to `startIso`, if that time is still free. */
export async function bookSlot(token: string, startIso: string): Promise<BookResult> {
  const view = await resolveBooking(token);
  if (!view) return { ok: false, error: "This booking link isn't valid." };
  if (!view.allowed) return { ok: false, error: view.blockedMessage ?? "This call can't be booked." };
  const slot = view.slots.find((s) => Date.parse(s.start) === Date.parse(startIso));
  if (!slot) return { ok: false, error: "Sorry, that time is no longer available. Please choose another." };

  const db = createAdminClient();
  let host: string | null = null;
  if (view.kind !== "intro_call") {
    const since = new Date().toISOString();
    const until = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const { data } = await db.from("appointments").select("host_id").in("host_id", slot.hostIds).eq("status", "booked").gte("starts_at", since).lte("starts_at", until);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { host_id: string }[]) counts.set(r.host_id, (counts.get(r.host_id) ?? 0) + 1);
    host = pickHost(slot.hostIds, counts);
  }

  const { error } = view.existing
    ? await db.rpc("reschedule_appointment", { p_id: view.existing.id, p_starts_at: slot.start, p_host_profile: host })
    : await db.rpc("book_appointment", { p_kind: view.kind, p_ref: view.refId, p_starts_at: slot.start, p_minutes: view.minutes, p_host_profile: host });
  if (error) return { ok: false, error: error.message };
  return { ok: true, startsAt: slot.start };
}

export async function cancelBooking(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const view = await resolveBooking(token);
  if (!view?.existing) return { ok: false, error: "There's no booking to cancel." };
  const { error } = await createAdminClient().rpc("cancel_appointment", { p_id: view.existing.id, p_reason: "Cancelled from the booking link" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export { CALL_LABELS };
