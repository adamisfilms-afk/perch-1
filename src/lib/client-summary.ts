// Client summary: the families list, the top-line KPIs and their targets.
// Pure functions, so they can be unit tested and shared by the server page and the client table.
import { ALLOCATABLE_STATUSES, FAMILY_STATUS_LABELS, type FamilyStatus, type FundingType } from "./domain";
import { AU_TZ } from "./time";

/** Order used when sorting by status: the funnel first, the waitlist next to matching, exits last. */
export const CLIENT_STATUS_ORDER: FamilyStatus[] = [
  "new",
  "contacted",
  "intake_booked",
  "intake_done",
  "ready_to_match",
  "waitlist",
  "offered",
  "accepted",
  "intro_booked",
  "intro_done",
  "converted",
  "lost",
  "not_suitable",
  "withdrawn",
];

/** On this page a converted family is an active client, and an accepted offer is a match. */
export const CLIENT_STATUS_LABELS: Record<FamilyStatus, string> = {
  ...FAMILY_STATUS_LABELS,
  offered: "Offered to clinician",
  accepted: "Matched",
  converted: "Active",
};

/** Why a clinician can't be allocated to a client at this step, or null when they can. */
export function allocationBlockedReason(status: FamilyStatus): string | null {
  if (ALLOCATABLE_STATUSES.includes(status)) return null;
  if (status === "converted") return "This client is active with their clinician.";
  if (["lost", "not_suitable", "withdrawn"].includes(status)) return "Reopen this client (set them back to Contacted) before allocating a clinician.";
  return "Complete the sign-up call first: save the intake on the full record.";
}

/** Statuses with no next step, so no time is counted. */
export const SETTLED_STATUSES: FamilyStatus[] = ["converted", "lost", "not_suitable", "withdrawn"];

/** Statuses with a time target between steps (the same targets drive the dashboard's stale alerts). */
export const STEP_TARGET_STATUSES: FamilyStatus[] = CLIENT_STATUS_ORDER.filter((s) => !SETTLED_STATUSES.includes(s));

export const FUNDING_SHORT: Record<FundingType, string> = {
  private: "Private",
  ndis_self_managed: "NDIS SM",
  ndis_plan_managed: "NDIS Plan",
  ndis_agency_managed: "NDIS Agency",
  medicare: "Medicare",
  unsure: "Unsure",
};

export interface KpiTargets {
  total_clients: number | null;
  active_rate_pct: number | null;
  signup_to_session_days: number | null;
  new_signups_7d: number | null;
}

export const DEFAULT_KPI_TARGETS: KpiTargets = {
  total_clients: 200,
  active_rate_pct: 50,
  signup_to_session_days: 7,
  new_signups_7d: 10,
};

/** Read the stored targets, ignoring anything that isn't a positive number. */
export function parseKpiTargets(value: unknown): KpiTargets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const num = (k: keyof KpiTargets) => {
    const n = Number(v[k]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    total_clients: num("total_clients"),
    active_rate_pct: num("active_rate_pct"),
    signup_to_session_days: num("signup_to_session_days"),
    new_signups_7d: num("new_signups_7d"),
  };
}

export type StepTargets = Partial<Record<FamilyStatus, number>>;

export function parseStepTargets(value: unknown): StepTargets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: StepTargets = {};
  for (const s of STEP_TARGET_STATUSES) {
    const n = Number(v[s]);
    if (v[s] !== null && v[s] !== undefined && Number.isFinite(n) && n > 0) out[s] = n;
  }
  return out;
}

/** "Noah Smith", or just "Noah" for children recorded before last names were collected. */
export function childFullName(c: { first_name: string; last_name?: string | null }): string {
  return c.last_name ? `${c.first_name} ${c.last_name}` : c.first_name;
}

export interface ClientRow {
  id: string;
  /** The child (or children) being seen, by full name: the client. Falls back to the parent if no child is recorded. */
  name: string;
  parentName: string;
  status: FamilyStatus;
  statusChangedAt: string;
  createdAt: string;
  state: string | null;
  suburb: string;
  funding: FundingType;
  /** Hours since the previous step, or null once the client has no next step. */
  elapsedHours: number | null;
  targetHours: number | null;
  overdue: boolean;
  /** Not recorded until session capture ships (v1.1). */
  sessionHours: number | null;
}

export function toClientRow(
  f: {
    id: string;
    parent_name: string;
    status: FamilyStatus;
    status_changed_at: string;
    created_at: string;
    state: string | null;
    suburb: string;
    funding_type: FundingType;
    children?: { first_name: string; last_name?: string | null }[] | null;
  },
  targets: StepTargets,
  now: number,
): ClientRow {
  const settled = SETTLED_STATUSES.includes(f.status);
  const elapsedHours = settled ? null : Math.max(0, (now - Date.parse(f.status_changed_at)) / 3_600_000);
  const targetHours = settled ? null : (targets[f.status] ?? null);
  return {
    id: f.id,
    name: f.children?.length ? f.children.map(childFullName).join(" & ") : f.parent_name,
    parentName: f.parent_name,
    status: f.status,
    statusChangedAt: f.status_changed_at,
    createdAt: f.created_at,
    state: f.state,
    suburb: f.suburb,
    funding: f.funding_type,
    elapsedHours,
    targetHours,
    overdue: elapsedHours !== null && targetHours !== null && elapsedHours > targetHours,
    sessionHours: null,
  };
}

/** "7h 5m": hours and minutes, the way coordinators compare against targets set in hours. */
export function formatElapsed(hours: number | null): string {
  if (hours === null) return "–";
  const totalMinutes = Math.floor(hours * 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/** "27-9-2026" in Sydney time. */
export function formatSignUpDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: AU_TZ, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/** Days and hours, e.g. { days: 7, hours: 10 }. */
export function splitDaysHours(hours: number): { days: number; hours: number } {
  const total = Math.round(hours);
  return { days: Math.floor(total / 24), hours: total % 24 };
}

export type SortKey = "name" | "status" | "elapsed" | "signup" | "session" | "location" | "funding";
export type SortDir = "asc" | "desc";

const statusRank = new Map(CLIENT_STATUS_ORDER.map((s, i) => [s, i]));

function compareNullable(a: number | string | null, b: number | string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en-AU");
}

/** Sort rows by a column. Blanks always go last; ties fall back to the newest sign-up first. */
export function sortClients(rows: ClientRow[], key: SortKey, dir: SortDir): ClientRow[] {
  const value = (r: ClientRow): number | string | null => {
    switch (key) {
      case "name":
        return r.name.toLowerCase();
      case "status":
        return statusRank.get(r.status) ?? 99;
      case "elapsed":
        return r.elapsedHours;
      case "signup":
        return Date.parse(r.createdAt);
      case "session":
        return r.sessionHours;
      case "location":
        return r.state;
      case "funding":
        return FUNDING_SHORT[r.funding];
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    let c: number;
    if (va === null || vb === null) c = compareNullable(va, vb); // blanks last in either direction
    else c = sign * compareNullable(va, vb);
    return c || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function filterClients(rows: ClientRow[], q: string): ClientRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    [r.name, r.parentName, r.suburb, r.state, CLIENT_STATUS_LABELS[r.status], FUNDING_SHORT[r.funding]].some((v) => v?.toLowerCase().includes(needle)),
  );
}

export interface ClientKpis {
  total: number;
  totalSeries: number[];
  active: number;
  activeRatePct: number | null;
  signupToSessionHours: number | null;
  signupToSessionCount: number;
  newSignups7d: number;
  newSignupsPrev7d: number;
  newSignupsSeries: number[];
}

const DAY = 86_400_000;

/**
 * KPIs for the top of the page.
 * - Total clients: everyone who has signed up, with the running total over the last 90 days.
 * - Active clients: share of all clients who have had a first session.
 * - Sign up to session: average time from sign-up to first session, for first sessions in the last 90 days.
 * - New sign ups: the last 7 days against the 7 before, with weekly counts for the last 12 weeks.
 */
export function computeKpis<T extends { created_at: string }>(
  families: T[],
  firstSessions: { created_at: string; first_session_at: string }[],
  now: number,
  /** What counts as active. Clients: a first session has happened. (The clinician summary passes its own.) */
  isActive: (item: T) => boolean = (item) => (item as { status?: FamilyStatus }).status === "converted",
): ClientKpis {
  const created = families.map((f) => Date.parse(f.created_at)).sort((a, b) => a - b);
  const total = families.length;
  const active = families.filter(isActive).length;

  const totalSeries: number[] = [];
  let i = 0;
  for (let d = 89; d >= 0; d--) {
    const end = now - d * DAY;
    while (i < created.length && created[i] <= end) i++;
    totalSeries.push(i);
  }

  const since = (from: number, to: number) => created.filter((t) => t > from && t <= to).length;
  const newSignupsSeries: number[] = [];
  for (let w = 11; w >= 0; w--) newSignupsSeries.push(since(now - (w + 1) * 7 * DAY, now - w * 7 * DAY));

  const recent = firstSessions
    .map((s) => ({ start: Date.parse(s.created_at), end: Date.parse(`${s.first_session_at.slice(0, 10)}T00:00:00+10:00`) }))
    .filter((s) => s.end >= now - 90 * DAY && s.end >= s.start);
  const signupToSessionHours = recent.length ? recent.reduce((sum, s) => sum + (s.end - s.start), 0) / recent.length / 3_600_000 : null;

  return {
    total,
    totalSeries,
    active,
    activeRatePct: total ? (active / total) * 100 : null,
    signupToSessionHours,
    signupToSessionCount: recent.length,
    newSignups7d: since(now - 7 * DAY, now),
    newSignupsPrev7d: since(now - 14 * DAY, now - 7 * DAY),
    newSignupsSeries,
  };
}
