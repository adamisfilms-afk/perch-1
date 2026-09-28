import { describe, expect, it } from "vitest";
import { readLinkToken } from "../booking/links";
import { buildVariables, renderTemplate } from "./render";

const links = { appUrl: "https://switchboard.example", linkSecret: "test-secret" };
const FAMILY = "0472d4db-d937-40dc-9de9-3bee70ae239b";
const CLINICIAN = "9b1f3c2a-0d4e-4c55-8a1b-2f6d7e8a9b0c";
const tokenOf = (url: unknown, prefix: string) => readLinkToken("test-secret", String(url).replace(`https://switchboard.example${prefix}`, ""));

describe("message rendering", () => {
  it("fills placeholders and leaves unknown ones blank", () => {
    expect(renderTemplate("Hi {{ name }}, {{missing}}!", { name: "Sam" })).toBe("Hi Sam, !");
  });

  it("builds signed Switchboard booking links for families and clinicians", () => {
    const v = buildVariables({ family_id: FAMILY, parent_first_name: "Sam" }, links);
    expect(tokenOf(v.intake_booking_url, "/book/")).toEqual({ kind: "signup_call", id: FAMILY, version: null });
    expect(v.recipient_first_name).toBe("Sam");

    const c = buildVariables({ clinician_id: CLINICIAN, clinician_name: "Priya Shah", link_version: 2 }, links);
    expect(tokenOf(c.screening_booking_url, "/book/")).toEqual({ kind: "clinician_intake", id: CLINICIAN, version: null });
    expect(tokenOf(c.clinician_url, "/clinician/")).toEqual({ kind: "clinician", id: CLINICIAN, version: 2 });
    expect(c.documents_url).toBe(`${c.clinician_url}#documents`);
    expect(c.portal_url).toBe(c.clinician_url);
  });

  it("gives clinicians a referral link, never the family's booking page", () => {
    const v = buildVariables({ clinician_id: CLINICIAN, link_version: 4, match_id: FAMILY }, links);
    expect(tokenOf(v.referral_url, "/referral/")).toEqual({ kind: "referral", id: FAMILY, version: 4 });
    expect(v.offer_url).toBe(v.referral_url);
    // without the clinician's link version (a family message), there's no referral link
    expect(buildVariables({ match_id: FAMILY, family_id: FAMILY }, links).referral_url).toBeUndefined();
  });

  it("writes the referral summary and, once accepted, the family's details", () => {
    const summary = { child_age: 5, suburb: "Newtown", service_type: "speech", funding_type: "private", concerns: ["speech_sounds"], preferred_times: [] };
    const offer = buildVariables(summary, links);
    expect(offer.referral_summary).toContain("Child: 5 years old");
    expect(offer.referral_summary).toContain("Area: Newtown");
    expect(offer.referral_summary).toContain("Preferred times: Flexible");
    expect(offer.family_details).toBeUndefined();

    const accepted = buildVariables({ ...summary, parent_name: "Sam Lee", parent_mobile: "+61412345678", parent_email: "sam@example.com", child_first_name: "Mia" }, links);
    expect(accepted.family_details).toContain("Parent or carer: Sam Lee");
    expect(accepted.family_details).toContain("Mobile: 0412 345 678");
    expect(accepted.family_details).toContain("Child: Mia, 5 years old");
    expect(accepted.family_details).not.toContain("Notes");
  });

  it("links booking messages back to the booking page and the host's record", () => {
    const v = buildVariables({ appointment_kind: "signup_call", family_id: FAMILY, record_path: `/families/${FAMILY}`, recipient_first_name: "Adam" }, links);
    expect(v.booking_url).toBe(v.intake_booking_url);
    expect(v.record_url).toBe(`https://switchboard.example/families/${FAMILY}`);
    expect(v.recipient_first_name).toBe("Adam");
  });

  it("adds friendly labels and one-click links", () => {
    const v = buildVariables({ credential_type: "wwcc", token: "abc", expires_at: "2026-11-01" }, links);
    expect(v.credential_label).toBe("Working with Children Check");
    expect(v.first_session_url).toBe("https://switchboard.example/r/first-session?token=abc");
    expect(v.expires_at_local).toBe("1 Nov 2026");
  });
});
