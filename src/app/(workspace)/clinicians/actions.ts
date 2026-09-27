"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { childFullName } from "@/lib/client-summary";
import { ONBOARDING_STAGES } from "@/lib/clinician-summary";
import type { CredentialType, FamilyStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { firstOf, type ClinicianRow, type CredentialRow } from "@/lib/types";

export interface ClinicianDetail {
  clinician: ClinicianRow;
  documents: { type: CredentialType; status: CredentialRow["status"]; expires_at: string | null }[];
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
    supabase.from("credentials").select("type, status, expires_at").eq("clinician_id", id).in("status", ["pending", "verified", "expired", "rejected"]).order("created_at", { ascending: false }),
    supabase.rpc("clinician_application_gaps", { p_clinician: id }),
    supabase.rpc("clinician_go_live_gaps", { p_clinician: id }),
    supabase.from("matches").select("family_id, families(status, children(first_name, last_name))").eq("clinician_id", id).eq("state", "accepted"),
    supabase.from("status_history").select("from_status, to_status, reason, by, at").eq("entity_type", "clinician").eq("entity_id", id).order("at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const names = new Map((people.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  // The newest document of each type is the one that counts.
  const latest = new Map<string, ClinicianDetail["documents"][number]>();
  for (const d of (documents.data ?? []) as ClinicianDetail["documents"]) if (!latest.has(d.type)) latest.set(d.type, d);

  type MatchJoin = { family_id: string; families: One<{ status: FamilyStatus; children: { first_name: string; last_name: string | null }[] | null }> };
  return {
    ok: true,
    detail: {
      clinician,
      documents: [...latest.values()],
      applicationGaps: (applicationGaps.data as string[] | null) ?? [],
      goLiveGaps: (goLiveGaps.data as string[] | null) ?? [],
      clients: ((matches.data ?? []) as unknown as MatchJoin[]).flatMap((m) => {
        const f = firstOf(m.families);
        return f ? [{ family_id: m.family_id, name: (f.children ?? []).map(childFullName).join(" & ") || "Client", status: f.status }] : [];
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
