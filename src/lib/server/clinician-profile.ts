import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGE_GROUPS, FUNDING_TYPES, SPECIAL_INTERESTS } from "../domain";
import { geocodeSuburb } from "../geo";
import { normaliseAuMobile } from "../phone";
import type { ClinicianRow } from "../types";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const pick = (fd: FormData, k: string, allowed: readonly string[]) =>
  fd.getAll(k).filter((v): v is string => typeof v === "string" && allowed.includes(v));

/** Profile fields a clinician maintains themselves (spec B4). Staff can edit these too. */
export async function parseProfile(
  fd: FormData,
  current: ClinicianRow,
): Promise<{ update: Partial<ClinicianRow>; error?: string; warning?: string }> {
  const mobileRaw = text(fd, "mobile");
  const mobile = mobileRaw ? normaliseAuMobile(mobileRaw) : null;
  if (mobileRaw && !mobile) return { update: {}, error: "Enter an Australian mobile number" };
  const postcode = text(fd, "postcode");
  if (postcode && !/^\d{4}$/.test(postcode)) return { update: {}, error: "Postcode must be 4 digits" };
  const radius = text(fd, "radius_km");
  const capacity = Number(text(fd, "capacity_new") ?? 0);
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 50) return { update: {}, error: "Capacity must be a whole number from 0 to 50" };
  const calcom = text(fd, "calcom_intro_url");
  if (calcom && !/^https:\/\/\S+$/.test(calcom)) return { update: {}, error: "The Cal.com link must start with https://" };
  const funding = pick(fd, "funding_types", FUNDING_TYPES).filter((f) => f !== "unsure") as ClinicianRow["funding_types"];
  if (funding.includes("ndis_agency_managed") && !current.ndis_registered) {
    return { update: {}, error: "Agency-managed NDIS families can only be seen by NDIS-registered clinicians. Upload your NDIS registration first." };
  }
  const postcodes = (text(fd, "service_postcodes") ?? "")
    .split(/[\s,]+/)
    .filter((p) => /^\d{4}$/.test(p));

  const update: Partial<ClinicianRow> = {
    name: text(fd, "name") ?? current.name,
    mobile,
    experience_years: text(fd, "experience_years") === null ? null : Number(text(fd, "experience_years")),
    gender: (["female", "male", "non_binary", "undisclosed"].includes(String(fd.get("gender"))) ? fd.get("gender") : null) as string | null,
    interests: pick(fd, "interests", SPECIAL_INTERESTS),
    age_groups: pick(fd, "age_groups", AGE_GROUPS),
    languages: (text(fd, "languages") ?? "English")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    suburb: text(fd, "suburb"),
    postcode,
    radius_km: radius === null ? null : Number(radius),
    service_postcodes: [...new Set(postcodes)],
    funding_types: funding,
    home_visits: fd.get("home_visits") === "on",
    telehealth: fd.get("telehealth") === "on",
    capacity_new: capacity,
    snoozed_until: text(fd, "snoozed_until"),
    calcom_intro_url: calcom,
  };

  let warning: string | undefined;
  if (update.suburb && update.postcode && (update.suburb !== current.suburb || update.postcode !== current.postcode || current.base_lat === null)) {
    const geo = await geocodeSuburb(update.suburb, update.postcode);
    update.base_lat = geo?.lat ?? null;
    update.base_lng = geo?.lng ?? null;
    if (!geo) warning = "Saved, but your home base couldn't be placed on the map. Add a list of postcodes you cover so you can still be matched.";
  }
  return { update, warning };
}

/** Replace a clinician's weekly time blocks with the ones submitted. */
export async function saveAvailability(supabase: SupabaseClient, clinicianId: string, fd: FormData): Promise<string | null> {
  const days = fd.getAll("slot_day").map(Number);
  const starts = fd.getAll("slot_start").map(String);
  const ends = fd.getAll("slot_end").map(String);
  const rows = days
    .map((d, i) => ({ clinician_id: clinicianId, day_of_week: d, start_time: starts[i], end_time: ends[i] }))
    .filter((r) => r.day_of_week >= 1 && r.day_of_week <= 7 && /^\d{2}:\d{2}/.test(r.start_time) && /^\d{2}:\d{2}/.test(r.end_time));
  if (rows.some((r) => r.end_time <= r.start_time)) return "Each time block must end after it starts";

  const { error: delError } = await supabase.from("availability").delete().eq("clinician_id", clinicianId);
  if (delError) return delError.message;
  if (rows.length) {
    const { error } = await supabase.from("availability").insert(rows);
    if (error) return error.message;
  }
  return null;
}
