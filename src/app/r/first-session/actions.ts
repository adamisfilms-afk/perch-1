"use server";

import type { ActionState } from "@/components/forms";
import { createAdminClient } from "@/lib/supabase/admin";

export async function confirmByToken(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const date = String(fd.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date of the first session" };
  const { error } = await createAdminClient().rpc("confirm_first_session_by_token", { p_token: token, p_date: date });
  if (error) return { error: error.message };
  return { ok: true, message: "Thanks! We've recorded it. The family is now yours to manage in Halaxy." };
}
