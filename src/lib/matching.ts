// Matching engine v1: hard filters, then a weighted rules score.
// Pure functions: no database or network access, so it's easy to test and to re-run
// for every waitlisted family. The result is only a suggestion: a person approves every match.

import { ageGroupFor, type AgeGroup, type FundingType, type Profession, type ServiceType, type TimeBlock } from "./domain";
import { distanceKm } from "./geo";

export interface AvailabilitySlot {
  day_of_week: number; // ISO 1 = Monday … 7 = Sunday
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
}

export interface MatchChild {
  id: string;
  age_years: number;
  service_type: ServiceType;
  concerns: string[];
  interests_needed: string[];
  preferred_times: TimeBlock[];
  language: string | null;
  gender_preference: "female" | "male" | null;
  telehealth_ok: boolean;
}

export interface MatchFamily {
  lat: number | null;
  lng: number | null;
  postcode: string;
  funding_type: FundingType;
}

export interface MatchClinician {
  id: string;
  name: string;
  status: string;
  profession: Profession;
  base_lat: number | null;
  base_lng: number | null;
  radius_km: number | null;
  service_postcodes: string[];
  age_groups: string[];
  funding_types: FundingType[];
  ndis_registered: boolean;
  capacity_new: number;
  snoozed_until: string | null; // ISO date
  interests: string[];
  languages: string[];
  gender: string | null;
  telehealth: boolean;
  availability: AvailabilitySlot[];
  /** Families accepted in the last 90 days: used to spread referrals fairly. */
  recent_accepts: number;
  /** Offers made / accepted in the last 12 months. */
  offers_total: number;
  offers_accepted: number;
}

export type FilterCode =
  | "not_active"
  | "profession"
  | "service_area"
  | "age_group"
  | "funding"
  | "capacity"
  | "snoozed"
  | "availability";

export const FILTER_LABELS: Record<FilterCode, string> = {
  not_active: "not active",
  profession: "wrong profession",
  service_area: "outside service area",
  age_group: "doesn't see this age group",
  funding: "doesn't accept this funding type",
  capacity: "no spare capacity",
  snoozed: "not taking new referrals",
  availability: "no overlapping times",
};

export interface Weights {
  distance: number;
  interests: number;
  language: number;
  availability: number;
  caseload: number;
  acceptance: number;
  preferences: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  distance: 30,
  interests: 20,
  language: 10,
  availability: 15,
  caseload: 10,
  acceptance: 10,
  preferences: 5,
};

export interface ScoreBreakdown {
  distance: number;
  interests: number;
  language: number;
  availability: number;
  caseload: number;
  acceptance: number;
  preferences: number;
}

export interface Candidate {
  clinician: MatchClinician;
  distance_km: number | null;
  score: number;
  breakdown: ScoreBreakdown;
  overlap_minutes: number;
  notes: string[];
}

export interface Rejection {
  clinician: MatchClinician;
  failed: FilterCode[];
  distance_km: number | null;
}

export interface MatchResult {
  shortlist: Candidate[];
  rejected: Rejection[];
  /** Filled when nobody passes: why, in words and as codes for recruitment targeting. */
  waitlist: { reason: string; codes: string[] } | null;
  warnings: string[];
}

// Family time blocks as weekly windows (ISO weekday, minutes from midnight).
const BLOCK_WINDOWS: Record<TimeBlock, { days: number[]; start: number; end: number }> = {
  school_hours: { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 15 * 60 },
  after_school: { days: [1, 2, 3, 4, 5], start: 15 * 60, end: 18 * 60 + 30 },
  weekends: { days: [6, 7], start: 7 * 60, end: 19 * 60 },
};

/** Minimum overlap for a time block to count as workable (one session plus a little travel). */
export const MIN_OVERLAP_MINUTES = 45;

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Total weekly minutes where the clinician's availability overlaps the family's preferred times. */
export function availabilityOverlap(slots: AvailabilitySlot[], blocks: TimeBlock[]): number {
  const wanted = blocks.length ? blocks : (Object.keys(BLOCK_WINDOWS) as TimeBlock[]);
  let total = 0;
  for (const slot of slots) {
    const s = toMinutes(slot.start_time);
    const e = toMinutes(slot.end_time);
    for (const block of wanted) {
      const w = BLOCK_WINDOWS[block];
      if (!w.days.includes(slot.day_of_week)) continue;
      const overlap = Math.min(e, w.end) - Math.max(s, w.start);
      if (overlap >= MIN_OVERLAP_MINUTES) total += overlap;
    }
  }
  return total;
}

function professionFor(service: ServiceType): Profession | null {
  if (service === "speech") return "speech_pathologist";
  if (service === "ot") return "occupational_therapist";
  return null; // not sure yet: either profession
}

function isSnoozed(snoozedUntil: string | null, today: string): boolean {
  return snoozedUntil !== null && snoozedUntil >= today;
}

/** Hard filters (spec C1). Returns every filter the clinician fails, so near-misses can be explained. */
export function hardFilters(
  child: MatchChild,
  family: MatchFamily,
  c: MatchClinician,
  today: string,
): { failed: FilterCode[]; distance_km: number | null } {
  const failed: FilterCode[] = [];
  if (c.status !== "active") failed.push("not_active");

  const profession = professionFor(child.service_type);
  if (profession && c.profession !== profession) failed.push("profession");

  let distance: number | null = null;
  if (family.lat !== null && family.lng !== null && c.base_lat !== null && c.base_lng !== null) {
    distance = distanceKm(family.lat, family.lng, c.base_lat, c.base_lng);
  }
  const inRadius = distance !== null && c.radius_km !== null && distance <= c.radius_km;
  const inPostcodes = c.service_postcodes.includes(family.postcode);
  const telehealthFit = child.telehealth_ok && c.telehealth;
  if (!inRadius && !inPostcodes && !telehealthFit) failed.push("service_area");

  if (!c.age_groups.includes(ageGroupFor(child.age_years) as AgeGroup)) failed.push("age_group");

  // "Not sure" is resolved on the intake call; until then it doesn't rule anyone out.
  if (family.funding_type !== "unsure") {
    const accepts = c.funding_types.includes(family.funding_type);
    const agencyOk = family.funding_type !== "ndis_agency_managed" || c.ndis_registered;
    if (!accepts || !agencyOk) failed.push("funding");
  }

  if (c.capacity_new <= 0) failed.push("capacity");
  if (isSnoozed(c.snoozed_until, today)) failed.push("snoozed");
  if (availabilityOverlap(c.availability, child.preferred_times) === 0) failed.push("availability");

  return { failed, distance_km: distance };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Weighted score out of 100 (spec C2). Each part is 0..1 then weighted. */
export function scoreCandidate(
  child: MatchChild,
  c: MatchClinician,
  distance: number | null,
  weights: Weights = DEFAULT_WEIGHTS,
): { score: number; breakdown: ScoreBreakdown; overlap_minutes: number; notes: string[] } {
  const notes: string[] = [];

  // Distance: closer is better (and means less travel billed to an NDIS plan).
  let distancePart = 0.5;
  if (distance !== null) {
    const radius = c.radius_km && c.radius_km > 0 ? c.radius_km : 20;
    distancePart = clamp01(1 - distance / Math.max(radius, 1));
  } else {
    notes.push("Matched on suburb list or telehealth, so distance wasn't scored");
  }

  // Special interests: share of the child's needs and concerns the clinician has a special interest in.
  const needs = new Set([...child.interests_needed, ...child.concerns.filter((x) => x !== "other")]);
  let interestsPart = 0.5;
  if (needs.size > 0) {
    const hits = [...needs].filter((n) => c.interests.includes(n));
    interestsPart = hits.length / needs.size;
    if (hits.length) notes.push(`Special interest in ${hits.join(", ").replaceAll("_", " ")}`);
  }

  // Language spoken at home.
  let languagePart = 1;
  if (child.language && child.language.toLowerCase() !== "english") {
    const speaks = c.languages.some((l) => l.toLowerCase() === child.language!.toLowerCase());
    languagePart = speaks ? 1 : 0;
    if (speaks) notes.push(`Speaks ${child.language}`);
  }

  // Availability: more overlapping time = easier to book. 4 hours a week counts as full marks.
  const overlap = availabilityOverlap(c.availability, child.preferred_times);
  const availabilityPart = clamp01(overlap / 240);

  // Caseload: spread referrals fairly across the network.
  const caseloadPart = clamp01(1 - c.recent_accepts / 6);

  // Acceptance history: new clinicians get the benefit of the doubt.
  const acceptancePart = c.offers_total >= 3 ? c.offers_accepted / c.offers_total : 0.75;

  // Family preferences such as clinician gender.
  let preferencesPart = 1;
  if (child.gender_preference) {
    preferencesPart = c.gender === child.gender_preference ? 1 : 0;
    if (!preferencesPart) notes.push(`Family prefers a ${child.gender_preference} clinician`);
  }

  const breakdown: ScoreBreakdown = {
    distance: round1(distancePart * weights.distance),
    interests: round1(interestsPart * weights.interests),
    language: round1(languagePart * weights.language),
    availability: round1(availabilityPart * weights.availability),
    caseload: round1(caseloadPart * weights.caseload),
    acceptance: round1(acceptancePart * weights.acceptance),
    preferences: round1(preferencesPart * weights.preferences),
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const max = Object.values(weights).reduce((a, b) => a + b, 0);
  return { score: round1((total / max) * 100), breakdown, overlap_minutes: overlap, notes };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Run matching for one child. Returns the top `limit` candidates by score, everyone
 * who was filtered out (and why), and a waitlist reason when nobody qualifies.
 */
export function runMatching(
  child: MatchChild,
  family: MatchFamily,
  clinicians: MatchClinician[],
  opts: { today: string; limit?: number; weights?: Weights; suburb?: string },
): MatchResult {
  const limit = opts.limit ?? 5;
  const warnings: string[] = [];
  if (family.lat === null || family.lng === null) {
    warnings.push("The family's suburb couldn't be placed on the map, so only suburb lists and telehealth can match.");
  }
  if (family.funding_type === "unsure") warnings.push("Funding type is still 'not sure': confirm it before offering.");
  if (child.service_type === "unsure") warnings.push("Service type is still 'not sure': both professions are included.");

  const shortlist: Candidate[] = [];
  const rejected: Rejection[] = [];
  for (const c of clinicians) {
    const { failed, distance_km } = hardFilters(child, family, c, opts.today);
    if (failed.length) {
      rejected.push({ clinician: c, failed, distance_km });
      continue;
    }
    const s = scoreCandidate(child, c, distance_km, opts.weights);
    shortlist.push({ clinician: c, distance_km, ...s });
  }
  shortlist.sort(
    (a, b) => b.score - a.score || (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || a.clinician.name.localeCompare(b.clinician.name),
  );

  const waitlist = shortlist.length ? null : explainNoMatch(rejected, family, child, opts.suburb);
  return { shortlist: shortlist.slice(0, limit), rejected, waitlist, warnings };
}

/**
 * Why nobody qualified. Counts, for each filter, the active clinicians for whom it was the
 * only thing standing in the way. That's the most useful signal for recruitment
 * ("we'd have 3 matches if someone covered 2150").
 */
export function explainNoMatch(
  rejected: Rejection[],
  family: MatchFamily,
  child: MatchChild,
  suburb?: string,
): { reason: string; codes: string[] } {
  const active = rejected.filter((r) => !r.failed.includes("not_active"));
  const soleBlockers = new Map<FilterCode, number>();
  for (const r of active) {
    if (r.failed.length === 1) soleBlockers.set(r.failed[0], (soleBlockers.get(r.failed[0]) ?? 0) + 1);
  }

  const codes = new Set<string>();
  const place = suburb ? `${suburb} ${family.postcode}` : family.postcode;
  const profession = professionFor(child.service_type) ?? "any";
  codes.add(`area:${family.postcode}`);
  codes.add(`profession:${profession}`);
  codes.add(`funding:${family.funding_type}`);
  codes.add(`age:${ageGroupFor(child.age_years)}`);

  if (active.length === 0) {
    return { reason: `No active clinicians for ${profession.replaceAll("_", " ")} near ${place}.`, codes: [...codes] };
  }

  const parts: string[] = [];
  const sorted = [...soleBlockers.entries()].sort((a, b) => b[1] - a[1]);
  for (const [code, n] of sorted) {
    parts.push(`${n} would match except ${code === "funding" && family.funding_type === "ndis_agency_managed" ? "not NDIS-registered (agency-managed)" : FILTER_LABELS[code]}`);
    codes.add(`blocker:${code}`);
  }
  if (!parts.length) {
    // Nobody was a near miss: report the most common failures instead.
    const counts = new Map<FilterCode, number>();
    for (const r of active) for (const f of r.failed) counts.set(f, (counts.get(f) ?? 0) + 1);
    for (const [code, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      parts.push(`${n} ${FILTER_LABELS[code]}`);
      codes.add(`blocker:${code}`);
    }
  }
  const prefix = family.funding_type === "ndis_agency_managed" ? "No NDIS-registered clinician" : "No clinician";
  return { reason: `${prefix} available for ${place}: ${parts.join("; ")}.`, codes: [...codes] };
}
