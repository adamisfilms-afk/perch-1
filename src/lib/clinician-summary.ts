// Clinician summary: onboarding stage, time in the stage, active clients and the top-line KPIs.
// Pure functions, like client-summary.ts, so they can be unit tested and shared by the page and the table.
import type { ClinicianStatus, Profession } from "./domain";
import { stateFromPostcode } from "./geo";

/**
 * The stages shown on the clinician summary, worked out from the database:
 * - New: signed up, application not submitted yet
 * - Application complete: submitted in the portal, intake call not booked
 * - Intake call booked: booked through Cal.com (the "screening" status)
 * - Ready: live (status active) with no active clients
 * - Active: live with at least one client whose first session is confirmed
 */
export const CLINICIAN_STAGES = ["new", "application_complete", "intake_booked", "ready", "active", "paused", "offboarded"] as const;
export type ClinicianStage = (typeof CLINICIAN_STAGES)[number];

export const CLINICIAN_STAGE_LABELS: Record<ClinicianStage, string> = {
  new: "New",
  application_complete: "Application complete",
  intake_booked: "Intake call booked",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  offboarded: "Off-boarded",
};

/** Stages still moving through onboarding (counted in the tab badge, and the ones with time targets). */
export const ONBOARDING_STAGES: ClinicianStage[] = ["new", "application_complete", "intake_booked"];

export type StageTargets = Partial<Record<ClinicianStage, number>>;

export function parseStageTargets(value: unknown): StageTargets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: StageTargets = {};
  for (const s of ONBOARDING_STAGES) {
    const n = Number(v[s]);
    if (v[s] !== null && v[s] !== undefined && Number.isFinite(n) && n > 0) out[s] = n;
  }
  return out;
}

export interface ClinicianKpiTargets {
  total_clinicians: number | null;
  active_rate_pct: number | null;
  signup_to_session_days: number | null;
  new_signups_7d: number | null;
}

export function parseClinicianKpiTargets(value: unknown): ClinicianKpiTargets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const num = (k: keyof ClinicianKpiTargets) => {
    const n = Number(v[k]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    total_clinicians: num("total_clinicians"),
    active_rate_pct: num("active_rate_pct"),
    signup_to_session_days: num("signup_to_session_days"),
    new_signups_7d: num("new_signups_7d"),
  };
}

export interface ClinicianSource {
  id: string;
  name: string;
  email: string;
  profession: Profession;
  status: ClinicianStatus;
  status_changed_at: string;
  created_at: string;
  application_submitted_at: string | null;
  suburb: string | null;
  postcode: string | null;
}

export function stageOf(c: Pick<ClinicianSource, "status" | "application_submitted_at">, activeClients: number): ClinicianStage {
  if (c.status === "offboarded") return "offboarded";
  if (c.status === "paused") return "paused";
  if (c.status === "active") return activeClients > 0 ? "active" : "ready";
  if (c.status === "screening") return "intake_booked";
  return c.application_submitted_at ? "application_complete" : "new";
}

export interface ClinicianSummaryRow {
  id: string;
  name: string;
  email: string;
  profession: Profession;
  stage: ClinicianStage;
  createdAt: string;
  /** Hours in the current stage, or null for Active, Paused and Off-boarded. */
  elapsedHours: number | null;
  targetHours: number | null;
  overdue: boolean;
  activeClients: number;
  /** Not recorded until session capture ships (v1.1). */
  sessionHours: number | null;
  state: string | null;
  suburb: string | null;
}

export function toClinicianRow(c: ClinicianSource, activeClients: number, targets: StageTargets, now: number): ClinicianSummaryRow {
  const stage = stageOf(c, activeClients);
  const since = stage === "new" ? c.created_at : stage === "application_complete" ? c.application_submitted_at : c.status_changed_at;
  const counting = stage === "new" || stage === "application_complete" || stage === "intake_booked" || stage === "ready";
  const elapsedHours = counting && since ? Math.max(0, (now - Date.parse(since)) / 3_600_000) : null;
  const targetHours = counting ? (targets[stage] ?? null) : null;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    profession: c.profession,
    stage,
    createdAt: c.created_at,
    elapsedHours,
    targetHours,
    overdue: elapsedHours !== null && targetHours !== null && elapsedHours > targetHours,
    activeClients,
    sessionHours: null,
    state: c.postcode ? stateFromPostcode(c.postcode) : null,
    suburb: c.suburb,
  };
}

export type ClinicianSortKey = "name" | "stage" | "elapsed" | "signup" | "clients" | "session" | "location";
export type SortDir = "asc" | "desc";

const stageRank = new Map(CLINICIAN_STAGES.map((s, i) => [s, i]));

/** Sort rows by a column. Blanks always go last; ties fall back to the newest sign-up first. */
export function sortClinicians(rows: ClinicianSummaryRow[], key: ClinicianSortKey, dir: SortDir): ClinicianSummaryRow[] {
  const value = (r: ClinicianSummaryRow): number | string | null => {
    switch (key) {
      case "name":
        return r.name.toLowerCase();
      case "stage":
        return stageRank.get(r.stage) ?? 99;
      case "elapsed":
        return r.elapsedHours;
      case "signup":
        return Date.parse(r.createdAt);
      case "clients":
        return r.activeClients;
      case "session":
        return r.sessionHours;
      case "location":
        return r.state;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    let c: number;
    if (va === null || vb === null) c = va === vb ? 0 : va === null ? 1 : -1;
    else c = sign * (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "en-AU"));
    return c || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function filterClinicians(rows: ClinicianSummaryRow[], q: string): ClinicianSummaryRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => [r.name, r.email, r.suburb, r.state, CLINICIAN_STAGE_LABELS[r.stage]].some((v) => v?.toLowerCase().includes(needle)));
}

/**
 * Sign up to session: for each clinician, from signing up to their first client's first session.
 * Returns one pair per clinician whose first ever session is known (computeKpis keeps the last 90 days).
 */
export function firstSessionsByClinician(
  clinicians: { id: string; created_at: string }[],
  sessions: { clinician_id: string; first_session_at: string }[],
): { created_at: string; first_session_at: string }[] {
  const first = new Map<string, string>();
  for (const s of sessions) {
    const prev = first.get(s.clinician_id);
    if (!prev || s.first_session_at < prev) first.set(s.clinician_id, s.first_session_at);
  }
  return clinicians.flatMap((c) => {
    const at = first.get(c.id);
    return at ? [{ created_at: c.created_at, first_session_at: at }] : [];
  });
}

/** Out of date: expired, or verified with an expiry date that has passed (before the nightly job marks it). */
export function isOutOfDate(d: { status: string; expires_at: string | null }, today: string): boolean {
  return d.status === "expired" || (d.status === "verified" && !!d.expires_at && d.expires_at < today);
}

/** How many of a clinician's current documents (the newest of each type, newest first in `docs`) are out of date. */
export function outOfDateCount(docs: { type: string; status: string; expires_at: string | null }[], today: string): number {
  const seen = new Set<string>();
  let n = 0;
  for (const d of docs) {
    if (d.status === "superseded" || seen.has(d.type)) continue;
    seen.add(d.type);
    if (isOutOfDate(d, today)) n += 1;
  }
  return n;
}
