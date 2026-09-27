import { describe, expect, it } from "vitest";
import { cleanAbn, isValidAbn, parseAbnResponse } from "./abn";
import { businessDaysBetween } from "./business-days";
import { calculateServiceFee } from "./fees";
import { distanceKm, stateFromPostcode } from "./geo";
import { formatAuMobile, normaliseAuMobile } from "./phone";
import { ageFrom, daysUntil, formatDate, todayInAustralia } from "./time";
import { enquirySchema, formDataToObject } from "./validation";
import { FAMILY_TRANSITIONS, requiredCredentialTypes } from "./domain";

describe("phone numbers", () => {
  it.each([
    ["0412 345 678", "+61412345678"],
    ["+61 412 345 678", "+61412345678"],
    ["61412345678", "+61412345678"],
    ["(04) 1234-5678", "+61412345678"],
  ])("normalises %s", (input, out) => expect(normaliseAuMobile(input)).toBe(out));

  it.each(["02 9876 5432", "0412 345 67", "+44 7700 900123", ""])("rejects %s", (input) => expect(normaliseAuMobile(input)).toBeNull());

  it("formats for display", () => expect(formatAuMobile("+61412345678")).toBe("0412 345 678"));
});

describe("ABN", () => {
  it("validates the checksum", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true); // the ATO's published example
    expect(isValidAbn("51 824 753 557")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
    expect(cleanAbn("51 824 753 556")).toBe("51824753556");
  });

  it("parses the ABN Lookup JSONP response", () => {
    const body = 'cb({"Abn":"51824753556","AbnStatus":"Active","EntityName":"Jane Citizen","BusinessName":[],"Gst":"2000-07-01","Message":""})';
    expect(parseAbnResponse(body)).toEqual({ abn: "51824753556", active: true, entityName: "Jane Citizen", gstRegistered: true });
    expect(parseAbnResponse('cb({"Abn":"","Message":"Search text is not a valid ABN or ACN"})')).toBeNull();
  });
});

describe("dates and time zones", () => {
  it("uses the Sydney date, not UTC", () => {
    // 2pm UTC on 25 Sep = midnight+ on 26 Sep in Sydney (AEST, UTC+10)
    expect(todayInAustralia(new Date("2026-09-25T14:30:00Z"))).toBe("2026-09-26");
  });

  it("computes ages and days until expiry", () => {
    expect(ageFrom("2021-09-26", null, "2026-09-25")).toBe(4);
    expect(ageFrom("2021-09-25", null, "2026-09-25")).toBe(5);
    expect(ageFrom(null, 7, "2026-09-25")).toBe(7);
    expect(daysUntil("2026-10-25", "2026-09-25")).toBe(30);
  });

  it("formats calendar dates without shifting them", () => expect(formatDate("2026-01-01")).toBe("1 Jan 2026"));

  it("counts business days, skipping weekends and holidays", () => {
    // Fri 25 Sep → Fri 2 Oct 2026 = 5 business days
    expect(businessDaysBetween(new Date("2026-09-25T00:00:00Z"), new Date("2026-10-02T00:00:00Z"))).toBe(5);
    expect(businessDaysBetween(new Date("2026-09-25T00:00:00Z"), new Date("2026-10-02T00:00:00Z"), ["2026-10-05", "2026-09-28"])).toBe(4);
  });
});

describe("geo", () => {
  it("measures Parramatta to Sydney CBD at about 19 km", () => {
    expect(distanceKm(-33.8148, 151.0017, -33.8688, 151.2093)).toBeCloseTo(20, 0);
  });
  it("infers state from postcode", () => {
    expect(stateFromPostcode("2150")).toBe("NSW");
    expect(stateFromPostcode("2600")).toBe("ACT");
    expect(stateFromPostcode("3000")).toBe("VIC");
    expect(stateFromPostcode("0800")).toBe("NT");
  });
});

describe("service fee", () => {
  it("charges 20% plus GST in whole cents", () => {
    expect(calculateServiceFee({ feeBaseCents: 1_234_567, rate: 0.2, gstRate: 0.1 })).toEqual({
      feeExGstCents: 246_913,
      gstCents: 24_691,
      feeIncGstCents: 271_604,
    });
  });
});

describe("enquiry validation", () => {
  const base = {
    parent_name: "Sam",
    email: "SAM@Example.com ",
    mobile: "0412 345 678",
    suburb: "Parramatta",
    postcode: "2150",
    child_first_name: "Alex",
    age_years: "5",
    concerns: ["language"],
    service_type: "speech",
    funding_type: "private",
    consent_privacy: true,
    consent_contact: true,
    consent_share: true,
  };

  it("normalises email and mobile", () => {
    const r = enquirySchema.parse(base);
    expect(r.email).toBe("sam@example.com");
    expect(r.mobile).toBe("+61412345678");
    expect(r.age_years).toBe(5);
  });

  it("needs an age or a date of birth, and all three consents", () => {
    expect(enquirySchema.safeParse({ ...base, age_years: "" }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...base, age_years: "", dob: "2021-03-01" }).success).toBe(true);
    expect(enquirySchema.safeParse({ ...base, consent_share: undefined }).success).toBe(false);
  });

  it("reads repeated checkboxes from FormData", () => {
    const fd = new FormData();
    fd.append("concerns", "language");
    fd.append("concerns", "literacy");
    fd.append("consent_share", "on");
    expect(formDataToObject(fd, ["concerns", "preferred_times"])).toEqual({
      concerns: ["language", "literacy"],
      consent_share: true,
      preferred_times: [],
    });
  });
});

describe("domain rules", () => {
  it("never lets a converted family move", () => expect(FAMILY_TRANSITIONS.converted).toEqual([]));
  it("requires the right registration per profession and home-visit documents", () => {
    expect(requiredCredentialTypes("speech_pathologist", false)).toContain("spa_cpsp");
    expect(requiredCredentialTypes("occupational_therapist", false)).toContain("ahpra");
    expect(requiredCredentialTypes("occupational_therapist", true)).toEqual(expect.arrayContaining(["drivers_licence", "car_insurance"]));
  });
});
