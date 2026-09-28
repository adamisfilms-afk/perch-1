"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { resolveAvailabilityLink } from "@/lib/server/booking";
import { parseWindows } from "@/lib/booking/windows";
import { createAdminClient } from "@/lib/supabase/admin";

// Every action re-checks the link: the token is bound in on the server, never taken from the form.

export async function saveHours(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveAvailabilityLink(token);
  if (!link) return { error: "This link has expired. Ask the Perch team for a new one." };
  const parsed = parseWindows(fd);
  if ("error" in parsed) return { error: parsed.error };
  const { error } = await createAdminClient().rpc("save_clinician_availability", {
    p_clinician: link.clinicianId,
    p_timezone: String(fd.get("timezone") ?? "Australia/Sydney"),
    p_windows: parsed.windows,
  });
  if (error) return { error: error.message };
  revalidatePath(`/availability/${token}`);
  return { ok: true, message: "Saved. Families will see these times when they book." };
}

export async function addDaysOff(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveAvailabilityLink(token);
  if (!link) return { error: "This link has expired. Ask the Perch team for a new one." };
  const starts = String(fd.get("starts_on") ?? "");
  const ends = String(fd.get("ends_on") ?? "") || starts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return { error: "Choose the first and last day off" };
  const { error } = await createAdminClient().rpc("add_time_off", {
    p_profile: null,
    p_clinician: link.clinicianId,
    p_starts: starts,
    p_ends: ends,
    p_note: String(fd.get("note") ?? ""),
  });
  if (error) return { error: error.message };
  revalidatePath(`/availability/${token}`);
  return { ok: true };
}

export async function removeDaysOff(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveAvailabilityLink(token);
  if (!link) return { error: "This link has expired. Ask the Perch team for a new one." };
  const { error } = await createAdminClient().rpc("remove_time_off", { p_id: String(fd.get("id")), p_clinician: link.clinicianId });
  if (error) return { error: error.message };
  revalidatePath(`/availability/${token}`);
  return { ok: true };
}
