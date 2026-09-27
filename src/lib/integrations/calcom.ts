// Cal.com booking webhooks. Bookings update the family or applicant status automatically.
// Booking links carry metadata[family_id] / metadata[match_id] / metadata[clinician_id],
// which Cal.com sends back in the webhook; email is the fallback.

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyCalcomSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type BookingKind = "intake" | "intro" | "screening";

export interface ParsedBooking {
  kind: BookingKind;
  ref: string | null;
  email: string | null;
  startTime: string;
  uid: string;
  cancelled: boolean;
}

interface CalcomWebhook {
  triggerEvent: string;
  payload: {
    uid?: string;
    startTime?: string;
    type?: string; // event type slug
    eventTypeId?: number;
    attendees?: { email?: string }[];
    metadata?: Record<string, string | undefined>;
    rescheduleUid?: string;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Work out what a booking is for. Metadata wins; otherwise the event-type slug is compared
 * with CALCOM_INTAKE_SLUG / CALCOM_SCREENING_SLUG, and anything else is a clinician intro call.
 */
export function parseCalcomWebhook(body: CalcomWebhook, slugs: { intake: string; screening: string }): ParsedBooking | null {
  const events = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"];
  if (!events.includes(body.triggerEvent)) return null;
  const p = body.payload ?? {};
  if (!p.uid || !p.startTime) return null;
  const meta = p.metadata ?? {};
  const pick = (v: string | undefined) => (v && UUID.test(v) ? v : null);

  let kind: BookingKind;
  let ref: string | null = null;
  if (pick(meta.family_id)) {
    kind = "intake";
    ref = pick(meta.family_id);
  } else if (pick(meta.match_id)) {
    kind = "intro";
    ref = pick(meta.match_id);
  } else if (pick(meta.clinician_id)) {
    kind = "screening";
    ref = pick(meta.clinician_id);
  } else if (p.type === slugs.intake) kind = "intake";
  else if (p.type === slugs.screening) kind = "screening";
  else kind = "intro";

  return {
    kind,
    ref,
    email: p.attendees?.[0]?.email?.toLowerCase() ?? null,
    startTime: p.startTime,
    uid: p.uid,
    cancelled: body.triggerEvent === "BOOKING_CANCELLED",
  };
}
