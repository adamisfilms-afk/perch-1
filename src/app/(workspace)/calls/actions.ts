"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { DEFAULT_BOOKING_SETTINGS, type BookingSettings } from "@/lib/booking/settings";
import { parseWindows } from "@/lib/booking/windows";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { createClient } from "@/lib/supabase/server";

export async function saveMyHours(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireStaff();
  const parsed = parseWindows(fd);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_staff_availability", {
    p_profile: viewer.userId,
    p_timezone: String(fd.get("timezone") ?? "Australia/Sydney"),
    p_hosts_signup: fd.get("hosts_signup_calls") === "on",
    p_hosts_clinician: fd.get("hosts_clinician_calls") === "on",
    p_windows: parsed.windows,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/calls");
  return { ok: true, message: "Saved. New bookings will use these hours." };
}

export async function addMyDaysOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireStaff();
  const starts = String(fd.get("starts_on") ?? "");
  const ends = String(fd.get("ends_on") ?? "") || starts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return { error: "Choose the first and last day off" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_time_off", { p_profile: viewer.userId, p_clinician: null, p_starts: starts, p_ends: ends, p_note: String(fd.get("note") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/calls");
  return { ok: true };
}

export async function removeMyDaysOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_time_off", { p_id: String(fd.get("id")), p_clinician: null });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/calls");
  return { ok: true };
}

/** Cancel a booked call. The person who booked (and the host) are emailed, and the pipeline steps back. */
export async function cancelCall(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const reason = String(fd.get("reason") ?? "").trim() || "Cancelled by the Perch team";
  const { error } = await supabase.rpc("cancel_appointment", { p_id: id, p_reason: reason });
  if (error) return { error: friendlyError(error) };
  after(drainOutboxQuietly);
  revalidatePath("/calls");
  return { ok: true, message: "Cancelled" };
}

export async function saveBookingSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireStaff(["admin"]);
  const value = {} as BookingSettings;
  for (const k of Object.keys(DEFAULT_BOOKING_SETTINGS) as (keyof BookingSettings)[]) {
    const n = Number(fd.get(k));
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { error: "Enter whole numbers" };
    value[k] = n;
  }
  for (const k of ["signup_call_minutes", "clinician_intake_minutes", "intro_call_minutes"] as const) {
    if (value[k] < 5 || value[k] > 240) return { error: "Call lengths must be between 5 and 240 minutes" };
  }
  if (value.horizon_days < 1 || value.horizon_days > 90) return { error: "People can book between 1 and 90 days ahead" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .update({ value, updated_by: viewer.userId, updated_at: new Date().toISOString() })
    .eq("key", "booking")
    .select("key");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "Only admins can change booking settings" };
  revalidatePath("/calls");
  return { ok: true, message: "Saved" };
}
