"use server";

import { after } from "next/server";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { clientIp } from "@/lib/server/request";
import { bookSlot, cancelBooking, type BookResult } from "@/lib/server/booking";
import { createAdminClient } from "@/lib/supabase/admin";

async function tooMany(token: string): Promise<boolean> {
  const ip = await clientIp();
  const { data } = await createAdminClient().rpc("check_rate_limit", { p_key: `book:${ip ?? "unknown"}:${token.slice(0, 40)}`, p_max: 20, p_window_seconds: 3600 });
  return data === false;
}

export async function book(token: string, startIso: string): Promise<BookResult> {
  if (await tooMany(token)) return { ok: false, error: "Too many changes in a short time. Please try again later." };
  const result = await bookSlot(token, startIso);
  if (result.ok) after(drainOutboxQuietly);
  return result;
}

export async function cancel(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await tooMany(token)) return { ok: false, error: "Too many changes in a short time. Please try again later." };
  const result = await cancelBooking(token);
  if (result.ok) after(drainOutboxQuietly);
  return result;
}
