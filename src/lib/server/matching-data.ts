import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchChild, MatchClinician, MatchFamily } from "../matching";
import { ageFrom, todayInAustralia } from "../time";
import type { AvailabilityRow, ChildRow, ClinicianRow, FamilyRow } from "../types";

/** Everyone who could plausibly match (not off-boarded), with availability and referral history. */
export async function loadMatchClinicians(supabase: SupabaseClient): Promise<MatchClinician[]> {
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const since365 = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [{ data: clinicians }, { data: availability }, { data: matches }] = await Promise.all([
    supabase.from("clinicians").select("*").not("status", "in", "(offboarded,applied,screening)"),
    supabase.from("availability").select("*"),
    supabase.from("matches").select("clinician_id, state, responded_at, offered_at").gte("offered_at", since365),
  ]);

  const slots = new Map<string, AvailabilityRow[]>();
  for (const a of (availability ?? []) as AvailabilityRow[]) slots.set(a.clinician_id, [...(slots.get(a.clinician_id) ?? []), a]);

  const stats = new Map<string, { recent: number; total: number; accepted: number }>();
  for (const m of (matches ?? []) as { clinician_id: string; state: string; responded_at: string | null }[]) {
    const s = stats.get(m.clinician_id) ?? { recent: 0, total: 0, accepted: 0 };
    if (["accepted", "declined", "timeout"].includes(m.state)) s.total += 1;
    if (m.state === "accepted") {
      s.accepted += 1;
      if (m.responded_at && m.responded_at >= since90) s.recent += 1;
    }
    stats.set(m.clinician_id, s);
  }

  return ((clinicians ?? []) as ClinicianRow[]).map((c) => {
    const s = stats.get(c.id) ?? { recent: 0, total: 0, accepted: 0 };
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      profession: c.profession,
      base_lat: c.base_lat,
      base_lng: c.base_lng,
      radius_km: c.radius_km === null ? null : Number(c.radius_km),
      service_postcodes: c.service_postcodes,
      age_groups: c.age_groups,
      funding_types: c.funding_types,
      ndis_registered: c.ndis_registered,
      capacity_new: c.capacity_new,
      snoozed_until: c.snoozed_until,
      interests: c.interests,
      languages: c.languages,
      gender: c.gender,
      telehealth: c.telehealth,
      availability: slots.get(c.id) ?? [],
      recent_accepts: s.recent,
      offers_total: s.total,
      offers_accepted: s.accepted,
    };
  });
}

export function toMatchChild(child: ChildRow): MatchChild {
  return {
    id: child.id,
    age_years: ageFrom(child.dob, child.age_years, todayInAustralia()) ?? 0,
    service_type: child.service_type,
    concerns: child.concerns,
    interests_needed: child.interests_needed,
    preferred_times: child.preferred_times,
    language: child.language,
    gender_preference: child.gender_preference,
    telehealth_ok: child.telehealth_ok,
  };
}

export function toMatchFamily(family: FamilyRow): MatchFamily {
  return { lat: family.lat, lng: family.lng, postcode: family.postcode, funding_type: family.funding_type };
}
