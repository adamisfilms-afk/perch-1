import { describe, expect, it } from "vitest";
import { availabilityOverlap, hardFilters, runMatching, type MatchChild, type MatchClinician, type MatchFamily } from "./matching";

const today = "2026-09-25";

const family: MatchFamily = { lat: -33.8148, lng: 151.0017, postcode: "2150", funding_type: "ndis_plan_managed" };

const child: MatchChild = {
  id: "child-1",
  age_years: 5,
  service_type: "speech",
  concerns: ["stuttering"],
  interests_needed: [],
  preferred_times: ["after_school"],
  language: null,
  gender_preference: null,
  telehealth_ok: false,
};

function clinician(overrides: Partial<MatchClinician> = {}): MatchClinician {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "Clinician",
    status: "active",
    profession: "speech_pathologist",
    base_lat: -33.82, // ~1 km from Parramatta
    base_lng: 151.0,
    radius_km: 15,
    service_postcodes: [],
    age_groups: ["3-5", "6-12"],
    funding_types: ["private", "ndis_plan_managed", "ndis_self_managed"],
    ndis_registered: false,
    capacity_new: 2,
    snoozed_until: null,
    interests: [],
    languages: ["English"],
    gender: "female",
    telehealth: false,
    availability: [{ day_of_week: 2, start_time: "15:00", end_time: "18:00" }],
    recent_accepts: 0,
    offers_total: 0,
    offers_accepted: 0,
    ...overrides,
  };
}

describe("hard filters", () => {
  it("passes a clinician who meets every rule", () => {
    expect(hardFilters(child, family, clinician(), today).failed).toEqual([]);
  });

  it.each([
    ["not active", { status: "paused" }, "not_active"],
    ["wrong profession", { profession: "occupational_therapist" as const }, "profession"],
    ["too far", { base_lat: -33.5, base_lng: 150.5 }, "service_area"],
    ["age group", { age_groups: ["13-17"] }, "age_group"],
    ["funding", { funding_types: ["private" as const] }, "funding"],
    ["no capacity", { capacity_new: 0 }, "capacity"],
    ["snoozed", { snoozed_until: "2026-10-01" }, "snoozed"],
    ["no overlapping time", { availability: [{ day_of_week: 2, start_time: "09:00", end_time: "12:00" }] }, "availability"],
  ])("rules out %s", (_, overrides, code) => {
    expect(hardFilters(child, family, clinician(overrides as Partial<MatchClinician>), today).failed).toContain(code);
  });

  it("only lets NDIS-registered clinicians see agency-managed families", () => {
    const agency = { ...family, funding_type: "ndis_agency_managed" as const };
    const accepts = clinician({ funding_types: ["ndis_agency_managed"] });
    expect(hardFilters(child, agency, accepts, today).failed).toEqual(["funding"]);
    expect(hardFilters(child, agency, { ...accepts, ndis_registered: true }, today).failed).toEqual([]);
  });

  it("treats a snooze that ended yesterday as over", () => {
    expect(hardFilters(child, family, clinician({ snoozed_until: "2026-09-24" }), today).failed).toEqual([]);
  });

  it("accepts a suburb-list service area when the family isn't geocoded", () => {
    const noCoords = { ...family, lat: null, lng: null };
    expect(hardFilters(child, noCoords, clinician(), today).failed).toEqual(["service_area"]);
    expect(hardFilters(child, noCoords, clinician({ service_postcodes: ["2150"] }), today).failed).toEqual([]);
  });

  it("lets telehealth cover distance when both sides are happy with it", () => {
    const far = clinician({ base_lat: -37.8, base_lng: 144.9, telehealth: true });
    expect(hardFilters({ ...child, telehealth_ok: true }, family, far, today).failed).toEqual([]);
  });

  it("includes both professions when the service type isn't decided", () => {
    const ot = clinician({ profession: "occupational_therapist" });
    expect(hardFilters({ ...child, service_type: "unsure" }, family, ot, today).failed).toEqual([]);
  });
});

describe("availability overlap", () => {
  it("counts only overlaps of at least 45 minutes", () => {
    expect(availabilityOverlap([{ day_of_week: 1, start_time: "14:30", end_time: "15:30" }], ["after_school"])).toBe(0);
    expect(availabilityOverlap([{ day_of_week: 1, start_time: "14:00", end_time: "16:00" }], ["after_school"])).toBe(60);
  });

  it("maps weekends to Saturday and Sunday", () => {
    expect(availabilityOverlap([{ day_of_week: 6, start_time: "08:00", end_time: "12:00" }], ["weekends"])).toBe(240);
    expect(availabilityOverlap([{ day_of_week: 5, start_time: "08:00", end_time: "12:00" }], ["weekends"])).toBe(0);
  });

  it("treats no stated preference as any time", () => {
    expect(availabilityOverlap([{ day_of_week: 3, start_time: "10:00", end_time: "11:00" }], [])).toBe(60);
  });
});

describe("scoring and ranking", () => {
  it("ranks closer clinicians with matching interests higher", () => {
    const near = clinician({ id: "near", name: "Near", interests: ["stuttering"] });
    const far = clinician({ id: "far", name: "Far", base_lat: -33.9, base_lng: 151.05 });
    const { shortlist } = runMatching(child, family, [far, near], { today });
    expect(shortlist.map((c) => c.clinician.id)).toEqual(["near", "far"]);
    expect(shortlist[0].notes.join(" ")).toMatch(/stuttering/);
  });

  it("spreads referrals: a busy clinician scores lower than an equal quiet one", () => {
    const busy = clinician({ id: "busy", name: "Busy", recent_accepts: 6 });
    const quiet = clinician({ id: "quiet", name: "Quiet" });
    const { shortlist } = runMatching(child, family, [busy, quiet], { today });
    expect(shortlist[0].clinician.id).toBe("quiet");
  });

  it("rewards a language match", () => {
    const vi = { ...child, language: "Vietnamese" };
    const speaks = clinician({ id: "vi", name: "Speaks", languages: ["English", "Vietnamese"] });
    const doesnt = clinician({ id: "en", name: "Doesnt" });
    expect(runMatching(vi, family, [doesnt, speaks], { today }).shortlist[0].clinician.id).toBe("vi");
  });

  it("returns at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) => clinician({ id: `c${i}`, name: `C${i}` }));
    expect(runMatching(child, family, many, { today }).shortlist).toHaveLength(5);
  });

  it("keeps the score within 0-100", () => {
    const { shortlist } = runMatching(child, family, [clinician({ interests: ["stuttering"], offers_total: 10, offers_accepted: 10 })], { today });
    expect(shortlist[0].score).toBeGreaterThan(80);
    expect(shortlist[0].score).toBeLessThanOrEqual(100);
  });
});

describe("waitlist reasons", () => {
  it("names the single thing that blocked near-misses, with codes for recruitment", () => {
    const agency = { ...family, funding_type: "ndis_agency_managed" as const };
    const result = runMatching(child, agency, [clinician({ funding_types: ["ndis_agency_managed"] })], { today, suburb: "Parramatta" });
    expect(result.shortlist).toEqual([]);
    expect(result.waitlist?.reason).toBe(
      "No NDIS-registered clinician available for Parramatta 2150: 1 would match except not NDIS-registered (agency-managed).",
    );
    expect(result.waitlist?.codes).toEqual(expect.arrayContaining(["area:2150", "funding:ndis_agency_managed", "blocker:funding"]));
  });

  it("says when there are no active clinicians at all", () => {
    const result = runMatching(child, family, [clinician({ status: "paused" })], { today });
    expect(result.waitlist?.reason).toMatch(/No active clinicians/);
  });
});
