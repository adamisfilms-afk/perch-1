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

    const c = buildVariables({ clinician_id: CLINICIAN, clinician_name: "Priya Shah", availability_link_version: 2, portal_token_hash: "h/1", portal_link_type: "invite" }, links);
    expect(tokenOf(c.screening_booking_url, "/book/")).toEqual({ kind: "clinician_intake", id: CLINICIAN, version: null });
    expect(tokenOf(c.availability_url, "/availability/")).toEqual({ kind: "availability", id: CLINICIAN, version: 2 });
    expect(c.portal_invite_url).toBe("https://switchboard.example/auth/confirm?token_hash=h%2F1&type=invite");
  });

  it("links booking messages back to the booking page and the host's record", () => {
    const v = buildVariables({ appointment_kind: "signup_call", family_id: FAMILY, record_path: `/families/${FAMILY}`, recipient_first_name: "Adam" }, links);
    expect(v.booking_url).toBe(v.intake_booking_url);
    expect(v.record_url).toBe(`https://switchboard.example/families/${FAMILY}`);
    expect(v.recipient_first_name).toBe("Adam");
  });

  it("adds friendly labels and one-click links", () => {
    const v = buildVariables({ credential_type: "wwcc", match_id: "m-1", token: "abc", expires_at: "2026-11-01" }, links);
    expect(v.credential_label).toBe("Working with Children Check");
    expect(v.offer_url).toBe("https://switchboard.example/portal/offers/m-1");
    expect(v.first_session_url).toBe("https://switchboard.example/r/first-session?token=abc");
    expect(v.expires_at_local).toBe("1 Nov 2026");
  });
});
