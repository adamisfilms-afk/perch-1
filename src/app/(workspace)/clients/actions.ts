"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import type { Booking } from "@/components/workspace/detail-parts";
import { friendlyError, requireStaff } from "@/lib/auth";
import { STEP_TARGET_STATUSES } from "@/lib/client-summary";
import type { Profession } from "@/lib/domain";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { bookingUrl } from "@/lib/server/booking";
import { loadActivity, type ActivityEntry } from "@/lib/server/activity";
import { createClient } from "@/lib/supabase/server";
import { firstOf, type ChildRow, type FamilyRow } from "@/lib/types";

export interface ClientDetail {
  family: FamilyRow & { assigned_name: string | null };
  children: ChildRow[];
  consents: { type: string; version: string; granted_at: string; withdrawn_at: string | null }[];
  intake: { scheduled_at: string | null; completed_at: string | null; outcome: string | null; outcome_reason: string | null; notes: string | null }[];
  matches: {
    id: string;
    clinician_id: string;
    clinician: string | null;
    state: string;
    rank: number;
    distance_km: number | null;
    offered_at: string | null;
    offer_expires_at: string | null;
    responded_at: string | null;
    response_reason: string | null;
    intro_at: string | null;
    intro_outcome: string | null;
    first_session_at: string | null;
  }[];
  /** Every event and message, newest first (the History tab). */
  activity: ActivityEntry[];
  /** Sign-up calls, intro calls and first sessions, in no particular order. */
  bookings: Booking[];
  /** When this was loaded: splits bookings into upcoming and past. */
  loadedAt: number;
  /** Booking pages staff can send by text or email, when that call can be booked. */
  links: { signupCall: string | null; introCall: string | null };
}

/** Everything about one client, for the summary modal. Reads as the signed-in user, so RLS applies, and logs the view. */
export async function getClientDetail(id: string): Promise<{ ok: true; detail: ClientDetail } | { ok: false; error: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data: family, error } = await supabase.from("families").select("*").eq("id", id).maybeSingle<FamilyRow>();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!family) return { ok: false, error: "This client couldn't be found." };
  await supabase.rpc("log_access", { p_entity_type: "families", p_entity_id: id, p_action: "view" });

  const [children, consents, intake, matches, people] = await Promise.all([
    supabase.from("children").select("*").eq("family_id", id).order("created_at"),
    supabase.from("consents").select("type, version, granted_at, withdrawn_at").eq("family_id", id).order("granted_at"),
    supabase.from("intake_calls").select("id, scheduled_at, completed_at, outcome, outcome_reason, notes").eq("family_id", id).order("created_at", { ascending: false }),
    supabase
      .from("matches")
      .select("id, clinician_id, state, rank, distance_km, offered_at, offer_expires_at, responded_at, response_reason, clinicians(name), intro_calls(id, scheduled_at, outcome, reason), conversions(first_session_at)")
      .eq("family_id", id)
      .not("offered_at", "is", null)
      .order("offered_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const names = new Map((people.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

  type MatchJoin = {
    id: string;
    clinician_id: string;
    state: string;
    rank: number;
    distance_km: number | null;
    offered_at: string | null;
    offer_expires_at: string | null;
    responded_at: string | null;
    response_reason: string | null;
    clinicians: { name: string } | { name: string }[] | null;
    intro_calls: { id: string; scheduled_at: string | null; outcome: string | null; reason: string | null }[] | null;
    conversions: { first_session_at: string } | { first_session_at: string }[] | null;
  };
  const matchRows = (matches.data ?? []) as unknown as MatchJoin[];
  type IntakeJoin = { id: string; scheduled_at: string | null; completed_at: string | null; outcome: string | null; outcome_reason: string | null; notes: string | null };
  const bookings: Booking[] = [
    ...((intake.data ?? []) as IntakeJoin[]).flatMap((i) =>
      i.scheduled_at || i.completed_at
        ? [{
            id: `intake-${i.id}`,
            kind: "Sign-up call",
            at: (i.scheduled_at ?? i.completed_at)!,
            with: null,
            detail: [i.completed_at ? `Done${i.outcome ? `: ${i.outcome.replaceAll("_", " ")}` : ""}` : null, i.outcome_reason, i.notes].filter(Boolean).join("\n") || null,
          }]
        : [],
    ),
    ...matchRows.flatMap((m) => {
      const clinician = firstOf(m.clinicians)?.name ?? null;
      const intros = (m.intro_calls ?? []).flatMap((c) =>
        c.scheduled_at
          ? [{ id: `intro-${c.id}`, kind: "Intro call", at: c.scheduled_at, with: clinician, detail: c.outcome ? [c.outcome.replaceAll("_", " "), c.reason].filter(Boolean).join(": ") : null }]
          : [],
      );
      const first = firstOf(m.conversions)?.first_session_at;
      return first ? [...intros, { id: `first-${m.id}`, kind: "First session", at: `${first.slice(0, 10)}T00:00:00+10:00`, with: clinician, detail: null, dateOnly: true }] : intros;
    }),
  ];

  return {
    ok: true,
    detail: {
      family: { ...family, assigned_name: family.assigned_to ? (names.get(family.assigned_to) ?? null) : null },
      children: (children.data ?? []) as ChildRow[],
      consents: consents.data ?? [],
      intake: intake.data ?? [],
      matches: matchRows.map((m) => {
        const intro = firstOf(m.intro_calls);
        return {
          id: m.id,
          clinician_id: m.clinician_id,
          clinician: firstOf(m.clinicians)?.name ?? null,
          state: m.state,
          rank: m.rank,
          distance_km: m.distance_km,
          offered_at: m.offered_at,
          offer_expires_at: m.offer_expires_at,
          responded_at: m.responded_at,
          response_reason: m.response_reason,
          intro_at: intro?.scheduled_at ?? null,
          intro_outcome: intro?.outcome ?? null,
          first_session_at: firstOf(m.conversions)?.first_session_at ?? null,
        };
      }),
      activity: await loadActivity(supabase, "family", id, names),
      bookings,
      loadedAt: Date.now(),
      links: {
        signupCall: ["new", "contacted", "intake_booked"].includes(family.status) ? bookingUrl("signup_call", family.id) : null,
        introCall: (() => {
          const live = matchRows.find((m) => m.state === "accepted");
          return live && ["accepted", "intro_booked"].includes(family.status) ? bookingUrl("intro_call", live.id) : null;
        })(),
      },
    },
  };
}

function positive(fd: FormData, name: string, scale = 1): number | null {
  const raw = String(fd.get(name) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Targets must be positive numbers (leave blank for no target)");
  return Math.round(n * scale * 100) / 100;
}

/** Save the time targets between steps and the KPI targets. Admins only (also enforced by RLS on settings). */
export async function saveClientTargets(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireStaff(["admin"]);
  let steps: Record<string, number | null>;
  let kpis: Record<string, number | null>;
  try {
    steps = Object.fromEntries(STEP_TARGET_STATUSES.map((s) => [s, positive(fd, `step_${s}`)]));
    kpis = {
      total_clients: positive(fd, "total_clients"),
      active_rate_pct: positive(fd, "active_rate_pct"),
      signup_to_session_days: positive(fd, "signup_to_session_days"),
      new_signups_7d: positive(fd, "new_signups_7d"),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (kpis.active_rate_pct !== null && kpis.active_rate_pct > 100) return { error: "Active clients target is a percentage (0 to 100)" };

  const supabase = await createClient();
  // Keep any step limits this form doesn't show; a blank field removes that step's target.
  const { data: current } = await supabase.from("settings").select("value").eq("key", "stale_limits_hours").maybeSingle();
  const merged: Record<string, number> = { ...((current?.value as Record<string, number>) ?? {}) };
  for (const [s, v] of Object.entries(steps)) {
    if (v === null) delete merged[s];
    else merged[s] = v;
  }
  const stamp = { updated_by: viewer.userId, updated_at: new Date().toISOString() };
  const [a, b] = await Promise.all([
    supabase.from("settings").update({ value: merged, ...stamp }).eq("key", "stale_limits_hours").select("key"),
    supabase.from("settings").update({ value: kpis, ...stamp }).eq("key", "client_kpi_targets").select("key"),
  ]);
  const err = a.error ?? b.error;
  if (err) return { error: friendlyError(err) };
  if (!a.data?.length || !b.data?.length) return { error: "Only admins can change targets" };
  revalidatePath("/clients");
  revalidatePath("/settings");
  return { ok: true, message: "Targets saved" };
}

export interface AllocatableClinician {
  id: string;
  name: string;
  profession: Profession;
  suburb: string | null;
  capacity: number;
  /** Families book their intro call in these times, so a clinician without any can't be allocated yet. */
  hasAvailability: boolean;
}

/** Active clinicians staff can allocate a client to, by name. */
export async function listAllocatableClinicians(): Promise<AllocatableClinician[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("clinicians")
    .select("id, name, profession, suburb, capacity_new, availability(id)")
    .eq("status", "active")
    .order("name");
  return (data ?? []).map(
    (c: { id: string; name: string; profession: Profession; suburb: string | null; capacity_new: number; availability: { id: string }[] | null }) => ({
      id: c.id,
      name: c.name,
      profession: c.profession,
      suburb: c.suburb,
      capacity: c.capacity_new,
      hasAvailability: (c.availability ?? []).length > 0,
    }),
  );
}

/** Allocate (or change) a client's clinician. The database does the work and queues the emails to both. */
export async function allocateClinician(familyId: string, clinicianId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  if (!clinicianId) return { ok: false, error: "Choose a clinician" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_clinician", { p_family: familyId, p_clinician: clinicianId });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/clients");
  revalidatePath(`/families/${familyId}`);
  after(drainOutboxQuietly);
  return { ok: true };
}
