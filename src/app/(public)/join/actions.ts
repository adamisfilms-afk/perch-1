"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { geocodeSuburb } from "@/lib/geo";
import { verifyTurnstile } from "@/lib/integrations/turnstile";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { clientIp } from "@/lib/server/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationSchema, fieldErrors, formDataToObject } from "@/lib/validation";

export async function submitApplication(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formDataToObject(fd, ["interests"]);
  const ip = await clientIp();
  if (!(await verifyTurnstile(fd.get("cf-turnstile-response") as string | null, ip))) {
    return { error: "Please complete the spam check and try again.", values: raw };
  }
  const parsed = applicationSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values: raw };
  }
  const db = createAdminClient();
  const { data: allowed } = await db.rpc("check_rate_limit", { p_key: `apply:${ip ?? "unknown"}`, p_max: 5, p_window_seconds: 3600 });
  if (allowed === false) return { error: "Too many applications from your connection. Please try again later.", values: raw };

  const v = parsed.data;
  const geo = await geocodeSuburb(v.suburb, v.postcode);
  const { error } = await db.rpc("submit_application", { p: { ...v, lat: geo?.lat ?? null, lng: geo?.lng ?? null } });
  if (error) {
    if (error.code === "23505") {
      return { error: "We already have an application from this email address. We'll be in touch soon.", values: raw };
    }
    console.error("submit_application failed", error.message);
    return { error: "Sorry, something went wrong. Please try again.", values: raw };
  }
  after(drainOutboxQuietly);
  redirect("/join/thanks");
}
