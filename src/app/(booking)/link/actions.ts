"use server";

import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { clientIp } from "@/lib/server/request";
import { createAdminClient } from "@/lib/supabase/admin";

const SENT = "If that email belongs to a Perch clinician, we've sent them their link. Check your inbox (and junk folder).";

/** Email a clinician their private link. The reply is the same whether or not we know the address. */
export async function requestLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter your email address", values: { email } };
  const db = createAdminClient();
  const ip = await clientIp();
  const [{ data: byIp }, { data: byEmail }] = await Promise.all([
    db.rpc("check_rate_limit", { p_key: `link:${ip ?? "unknown"}`, p_max: 10, p_window_seconds: 3600 }),
    db.rpc("check_rate_limit", { p_key: `link-email:${email}`, p_max: 3, p_window_seconds: 3600 }),
  ]);
  if (byIp === false || byEmail === false) return { error: "Too many requests. Please try again in an hour." };
  const { error } = await db.rpc("request_clinician_link", { p_email: email });
  if (error) {
    console.error("request_clinician_link failed", error.message);
    return { error: "Sorry, something went wrong. Please try again." };
  }
  after(drainOutboxQuietly);
  return { ok: true, message: SENT };
}
