"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import type { Booking } from "@/components/workspace/detail-parts";
import { friendlyError, requireStaff } from "@/lib/auth";
import { childFullName } from "@/lib/client-summary";
import { ONBOARDING_STAGES, isOutOfDate } from "@/lib/clinician-summary";
import type { CredentialType, FamilyStatus } from "@/lib/domain";
import { bookingUrl } from "@/lib/server/booking";
import { clinicianUrl } from "@/lib/server/clinician-link";
import { createClient } from "@/lib/supabase/server";
import { todayInAustralia } from "@/lib/time";
import { firstOf, type ClinicianRow, type CredentialRow } from "@/lib/types";

export interface ClinicianDetail {
  clinician: ClinicianRow;
  /** The current document of each type (newest first), not counting superseded ones. */
  documents: {
    id: string;
    type: CredentialType;
    status: CredentialRow["status"];
    expires_at: string | null;
    number: string | null;
    has_file: boolean;
    sighted_only: boolean;
    created_at: string;
    verified_at: string | null;
    out_of_date: boolean;
  }[];
  agreements: { version: string; sent_at: string | null; signed_at: string | null; documenso_ref: string | null }[];
  /** Documents that have expired (or were verified with an expiry date that has now passed). */
  outOfDate: number;
  bookings: Booking[];
  /** When this was loaded: splits bookings into upcoming and past. */
  loadedAt: number;
  /** Weekly hours families can book intro calls in, and the clinician's private links. */
  availability: { day: number; start: string; end: string }[];
  links: { clinicianPage: string; intakeCall: string | null };
  applicationGaps: string[];
  goLiveGaps: string[];
  clients: { family_id: string; name: string; status: FamilyStatus }[];
  history: { from_status: string | null; to_status: string; reason: string | null; by: string | null; at: string }[];
}

type One<T> = T | T[] | null;

/** Everything about one clinician, for the summary modal. Reads as the signed-in user, so RLS applies, and logs the view. */
export async function getClinicianDetail(id: string): Promise<{ ok: true; detail: ClinicianDetail } | { ok: false; error: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data: clinician, error } = await supabase.from("clinicians").select("*").eq("id", id).maybeSingle<ClinicianRow>();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!clinician) return { ok: false, error: "This clinician couldn't be found." };
  await supabase.rpc("log_access", { p_entity_type: "clinicians", p_entity_id: id, p_action: "view" });

  const [documents, applicationGaps, goLiveGaps, matches, history, people] = await Promise.all([
    supabase
      .from("credentials")
      .select("id, type, status, expires_at, number, file_path, sighted_only, created_at, verified_at")
      .eq("clinician_id", id)
      .in("status", ["pending", "verified", "expired", "rejected"])
      .order("created_at", { ascending: false }),
    supabase.rpc("clinician_application_gaps", { p_clinician: id }),
    supabase.rpc("clinician_go_live_gaps", { p_clinician: id }),
    supabase
      .from("matches")
      .select("id, family_id, state, families(status, children(first_name, last_name)), intro_calls(id, scheduled_at, outcome, reason), conversions(first_session_at)")
      .eq("clinician_id", id)
      .in("state", ["accepted", "withdrawn"]),
    supabase.from("status_history").select("from_status, to_status, reason, by, at").eq("entity_type", "clinician").eq("entity_id", id).order("at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const { data: hours } = await supabase.from("availability").select("day_of_week, start_time, end_time").eq("clinician_id", id).order("day_of_week").order("start_time");
  const { data: agreements } = await supabase
    .from("agreements")
    .select("version, sent_at, signed_at, documenso_ref")
    .eq("clinician_id", id)
    .order("created_at", { ascending: false });
  const names = new Map((people.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  // The newest document of each type is the one that counts.
  const today = todayInAustralia();
  type DocRow = Omit<ClinicianDetail["documents"][number], "has_file" | "out_of_date"> & { file_path: string | null };
  const latest = new Map<string, ClinicianDetail["documents"][number]>();
  for (const d of (documents.data ?? []) as DocRow[]) {
    if (latest.has(d.type)) continue;
    const { file_path, ...rest } = d;
    const out_of_date = isOutOfDate(d, today);
    latest.set(d.type, { ...rest, has_file: !!file_path, out_of_date });
  }

  type MatchJoin = {
    id: string;
    family_id: string;
    state: string;
    families: One<{ status: FamilyStatus; children: { first_name: string; last_name: string | null }[] | null }>;
    intro_calls: { id: string; scheduled_at: string | null; outcome: string | null; reason: string | null }[] | null;
    conversions: One<{ first_session_at: string }>;
  };
  const matchRows = (matches.data ?? []) as unknown as MatchJoin[];
  const clientName = (m: MatchJoin) => (firstOf(m.families)?.children ?? []).map(childFullName).join(" & ") || "Client";
  const screeningAt = typeof clinician.application.screening_at === "string" ? clinician.application.screening_at : null;
  const bookings: Booking[] = [
    ...(screeningAt
      ? [{ id: "intake", kind: "Intake call", at: screeningAt, with: "Perch team", detail: clinician.intake_completed_at ? "Done" : null }]
      : []),
    ...matchRows.flatMap((m) => {
      const intros: Booking[] = (m.intro_calls ?? []).flatMap((c) =>
        c.scheduled_at
          ? [{ id: `intro-${c.id}`, kind: "Intro call", at: c.scheduled_at, with: clientName(m), detail: c.outcome ? [c.outcome.replaceAll("_", " "), c.reason].filter(Boolean).join(": ") : null }]
          : [],
      );
      const first = firstOf(m.conversions)?.first_session_at;
      return first ? [...intros, { id: `first-${m.id}`, kind: "First session", at: `${first.slice(0, 10)}T00:00:00+10:00`, with: clientName(m), detail: null, dateOnly: true }] : intros;
    }),
  ];
  return {
    ok: true,
    detail: {
      clinician,
      documents: [...latest.values()],
      agreements: agreements ?? [],
      outOfDate: [...latest.values()].filter((d) => d.out_of_date).length,
      bookings,
      loadedAt: Date.now(),
      availability: (hours ?? []).map((h: { day_of_week: number; start_time: string; end_time: string }) => ({
        day: h.day_of_week,
        start: h.start_time.slice(0, 5),
        end: h.end_time.slice(0, 5),
      })),
      links: {
        clinicianPage: clinicianUrl(clinician.id, clinician.link_version),
        intakeCall: ["applied", "screening"].includes(clinician.status) ? bookingUrl("clinician_intake", clinician.id) : null,
      },
      applicationGaps: (applicationGaps.data as string[] | null) ?? [],
      goLiveGaps: (goLiveGaps.data as string[] | null) ?? [],
      clients: matchRows.flatMap((m) => {
        const f = firstOf(m.families);
        return m.state === "accepted" && f ? [{ family_id: m.family_id, name: clientName(m), status: f.status }] : [];
      }),
      history: (history.data ?? []).map((h: ClinicianDetail["history"][number]) => ({ ...h, by: h.by ? (names.get(h.by) ?? null) : null })),
    },
  };
}

function positive(fd: FormData, name: string): number | null {
  const raw = String(fd.get(name) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Targets must be positive numbers (leave blank for no target)");
  return Math.round(n * 100) / 100;
}

/** Save the onboarding step targets and the KPI targets. Admins only (also enforced by RLS on settings). */
export async function saveClinicianTargets(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireStaff(["admin"]);
  let steps: Record<string, number>;
  let kpis: Record<string, number | null>;
  try {
    steps = Object.fromEntries(ONBOARDING_STAGES.flatMap((s) => {
      const v = positive(fd, `step_${s}`);
      return v === null ? [] : [[s, v]];
    }));
    kpis = {
      total_clinicians: positive(fd, "total_clinicians"),
      active_rate_pct: positive(fd, "active_rate_pct"),
      signup_to_session_days: positive(fd, "signup_to_session_days"),
      new_signups_7d: positive(fd, "new_signups_7d"),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (kpis.active_rate_pct !== null && kpis.active_rate_pct > 100) return { error: "Active clinicians target is a percentage (0 to 100)" };
  const supabase = await createClient();
  const stamp = { updated_by: viewer.userId, updated_at: new Date().toISOString() };
  const [a, b] = await Promise.all([
    supabase.from("settings").update({ value: steps, ...stamp }).eq("key", "clinician_step_targets_hours").select("key"),
    supabase.from("settings").update({ value: kpis, ...stamp }).eq("key", "clinician_kpi_targets").select("key"),
  ]);
  const err = a.error ?? b.error;
  if (err) return { error: friendlyError(err) };
  if (!a.data?.length || !b.data?.length) return { error: "Only admins can change targets" };
  revalidatePath("/clinicians");
  return { ok: true, message: "Targets saved" };
}
