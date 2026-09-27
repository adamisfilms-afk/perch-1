"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { STEP_TARGET_STATUSES } from "@/lib/client-summary";
import { createClient } from "@/lib/supabase/server";
import { firstOf, type ChildRow, type FamilyRow } from "@/lib/types";

export interface ClientDetail {
  family: FamilyRow & { assigned_name: string | null };
  children: ChildRow[];
  consents: { type: string; version: string; granted_at: string; withdrawn_at: string | null }[];
  intake: { scheduled_at: string | null; completed_at: string | null; outcome: string | null; outcome_reason: string | null; notes: string | null }[];
  matches: {
    id: string;
    clinician: string | null;
    state: string;
    rank: number;
    distance_km: number | null;
    offered_at: string | null;
    responded_at: string | null;
    response_reason: string | null;
    intro_at: string | null;
    intro_outcome: string | null;
    first_session_at: string | null;
  }[];
  history: { from_status: string | null; to_status: string; reason: string | null; by: string | null; at: string }[];
}

/** Everything about one client, for the summary modal. Reads as the signed-in user, so RLS applies, and logs the view. */
export async function getClientDetail(id: string): Promise<{ ok: true; detail: ClientDetail } | { ok: false; error: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data: family, error } = await supabase.from("families").select("*").eq("id", id).maybeSingle<FamilyRow>();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!family) return { ok: false, error: "This client couldn't be found." };
  await supabase.rpc("log_access", { p_entity_type: "families", p_entity_id: id, p_action: "view" });

  const [children, consents, intake, matches, history, people] = await Promise.all([
    supabase.from("children").select("*").eq("family_id", id).order("created_at"),
    supabase.from("consents").select("type, version, granted_at, withdrawn_at").eq("family_id", id).order("granted_at"),
    supabase.from("intake_calls").select("scheduled_at, completed_at, outcome, outcome_reason, notes").eq("family_id", id).order("created_at", { ascending: false }),
    supabase
      .from("matches")
      .select("id, state, rank, distance_km, offered_at, responded_at, response_reason, clinicians(name), intro_calls(scheduled_at, outcome), conversions(first_session_at)")
      .eq("family_id", id)
      .not("offered_at", "is", null)
      .order("offered_at", { ascending: false }),
    supabase.from("status_history").select("from_status, to_status, reason, by, at").eq("entity_type", "family").eq("entity_id", id).order("at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const names = new Map((people.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

  type MatchJoin = {
    id: string;
    state: string;
    rank: number;
    distance_km: number | null;
    offered_at: string | null;
    responded_at: string | null;
    response_reason: string | null;
    clinicians: { name: string } | { name: string }[] | null;
    intro_calls: { scheduled_at: string | null; outcome: string | null }[] | null;
    conversions: { first_session_at: string } | { first_session_at: string }[] | null;
  };

  return {
    ok: true,
    detail: {
      family: { ...family, assigned_name: family.assigned_to ? (names.get(family.assigned_to) ?? null) : null },
      children: (children.data ?? []) as ChildRow[],
      consents: consents.data ?? [],
      intake: intake.data ?? [],
      matches: ((matches.data ?? []) as unknown as MatchJoin[]).map((m) => {
        const intro = firstOf(m.intro_calls);
        return {
          id: m.id,
          clinician: firstOf(m.clinicians)?.name ?? null,
          state: m.state,
          rank: m.rank,
          distance_km: m.distance_km,
          offered_at: m.offered_at,
          responded_at: m.responded_at,
          response_reason: m.response_reason,
          intro_at: intro?.scheduled_at ?? null,
          intro_outcome: intro?.outcome ?? null,
          first_session_at: firstOf(m.conversions)?.first_session_at ?? null,
        };
      }),
      history: (history.data ?? []).map((h: ClientDetail["history"][number]) => ({ ...h, by: h.by ? (names.get(h.by) ?? null) : null })),
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
