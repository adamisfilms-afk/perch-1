import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { parseCalcomWebhook, verifyCalcomSignature } from "@/lib/integrations/calcom";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { createAdminClient } from "@/lib/supabase/admin";

// Cal.com → The Switchboard. Set this URL and a secret on each event type's webhook in Cal.com.
export async function POST(request: NextRequest) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyCalcomSignature(raw, request.headers.get("x-cal-signature-256"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const booking = parseCalcomWebhook(JSON.parse(raw), {
    intake: process.env.CALCOM_INTAKE_SLUG ?? "intake",
    screening: process.env.CALCOM_SCREENING_SLUG ?? "screening",
  });
  if (!booking) return NextResponse.json({ ignored: true });

  const { data, error } = await createAdminClient().rpc("record_booking", {
    p_kind: booking.kind,
    p_ref: booking.ref,
    p_email: booking.email,
    p_start: booking.startTime,
    p_uid: booking.uid,
    p_cancelled: booking.cancelled,
  });
  if (error) {
    console.error("Cal.com webhook failed", error.message);
    return NextResponse.json({ error: "Could not record booking" }, { status: 500 });
  }
  after(drainOutboxQuietly);
  return NextResponse.json({ result: data });
}
