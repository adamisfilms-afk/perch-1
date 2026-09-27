"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { geocodeSuburb, stateFromPostcode } from "@/lib/geo";
import { verifyTurnstile } from "@/lib/integrations/turnstile";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { clientIp } from "@/lib/server/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { enquirySchema, fieldErrors, formDataToObject } from "@/lib/validation";

export async function submitEnquiry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formDataToObject(fd, ["concerns", "preferred_times"]);
  const ip = await clientIp();

  if (!(await verifyTurnstile(fd.get("cf-turnstile-response") as string | null, ip))) {
    return { error: "Please complete the spam check and try again.", values: raw };
  }

  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values: raw };
  }

  const db = createAdminClient();
  const { data: allowed } = await db.rpc("check_rate_limit", { p_key: `enquiry:${ip ?? "unknown"}`, p_max: 5, p_window_seconds: 3600 });
  if (allowed === false) {
    return { error: "We've had several enquiries from your connection in the last hour. Please try again later, or email us.", values: raw };
  }

  const v = parsed.data;
  // If the map service is down we still save the enquiry; staff fix the location later.
  const geo = await geocodeSuburb(v.suburb, v.postcode);
  const { error } = await db.rpc("submit_enquiry", {
    p: {
      ...v,
      state: geo?.state ?? stateFromPostcode(v.postcode),
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    },
  });
  if (error) {
    console.error("submit_enquiry failed", error.message);
    return { error: "Sorry, something went wrong saving your enquiry. Please try again.", values: raw };
  }

  after(drainOutboxQuietly);
  redirect("/enquire/thanks");
}
