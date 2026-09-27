import { describe, expect, it } from "vitest";
import { buildVariables, renderTemplate } from "./render";

const links = { appUrl: "https://switchboard.example", intakeBookingUrl: "https://cal.com/team/intake" };

describe("message rendering", () => {
  it("fills placeholders and leaves unknown ones blank", () => {
    expect(renderTemplate("Hi {{ name }}, {{missing}}!", { name: "Sam" })).toBe("Hi Sam, !");
  });

  it("builds a booking link that carries the family id back through Cal.com", () => {
    const v = buildVariables({ family_id: "f-1", parent_name: "Sam Parent" }, links);
    const url = new URL(v.intake_booking_url as string);
    expect(url.origin + url.pathname).toBe("https://cal.com/team/intake");
    expect(url.searchParams.get("metadata[family_id]")).toBe("f-1");
    expect(url.searchParams.get("name")).toBe("Sam Parent");
  });

  it("adds friendly labels and one-click links", () => {
    const v = buildVariables({ credential_type: "wwcc", match_id: "m-1", token: "abc", expires_at: "2026-11-01" }, links);
    expect(v.credential_label).toBe("Working with Children Check");
    expect(v.offer_url).toBe("https://switchboard.example/portal/offers/m-1");
    expect(v.first_session_url).toBe("https://switchboard.example/r/first-session?token=abc");
    expect(v.expires_at_local).toBe("1 Nov 2026");
  });
});
