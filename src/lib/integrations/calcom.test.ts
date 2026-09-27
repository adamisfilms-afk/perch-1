import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCalcomWebhook, verifyCalcomSignature } from "./calcom";

const slugs = { intake: "intake", screening: "screening" };
const FAMILY = "0b0c9a4e-3a44-4a4b-9a57-1a1b2c3d4e5f";

describe("Cal.com webhooks", () => {
  it("verifies the HMAC signature", () => {
    const body = '{"a":1}';
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyCalcomSignature(body, sig, "secret")).toBe(true);
    expect(verifyCalcomSignature(body, sig, "other")).toBe(false);
    expect(verifyCalcomSignature(body, null, "secret")).toBe(false);
  });

  it("uses metadata to link a booking to a family", () => {
    const parsed = parseCalcomWebhook(
      {
        triggerEvent: "BOOKING_CREATED",
        payload: { uid: "u1", startTime: "2026-10-01T00:00:00Z", type: "anything", attendees: [{ email: "Sam@x.com" }], metadata: { family_id: FAMILY } },
      },
      slugs,
    );
    expect(parsed).toEqual({ kind: "intake", ref: FAMILY, email: "sam@x.com", startTime: "2026-10-01T00:00:00Z", uid: "u1", cancelled: false });
  });

  it("falls back to the event type, and ignores unrelated events and bad ids", () => {
    const base = { uid: "u2", startTime: "2026-10-01T00:00:00Z", metadata: { family_id: "not-a-uuid" } };
    expect(parseCalcomWebhook({ triggerEvent: "BOOKING_CREATED", payload: { ...base, type: "screening" } }, slugs)?.kind).toBe("screening");
    expect(parseCalcomWebhook({ triggerEvent: "BOOKING_CANCELLED", payload: { ...base, type: "intro-call" } }, slugs)).toMatchObject({
      kind: "intro",
      ref: null,
      cancelled: true,
    });
    expect(parseCalcomWebhook({ triggerEvent: "MEETING_ENDED", payload: base }, slugs)).toBeNull();
  });
});
