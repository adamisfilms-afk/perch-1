"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { friendlyError } from "@/lib/auth";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { resolveSessionsCheck } from "@/lib/server/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

/** The family's answer to "is this the right number of sessions?". The token is re-checked here. */
export async function answer(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const check = await resolveSessionsCheck(token);
  if (!check) return { error: "This link has expired. Reply to our message and we'll sort it out." };
  const confirmed = fd.get("answer") === "yes";
  const note = String(fd.get("note") ?? "").trim();
  const { error } = await createAdminClient("family").rpc("respond_session_confirmation", { p_id: check.id, p_confirmed: confirmed, p_note: note || null });
  if (error) return { error: friendlyError(error) };
  after(drainOutboxQuietly);
  revalidatePath(`/check/${token}`);
  return { ok: true, message: confirmed ? "Thanks for confirming." : "Thanks for letting us know. The Perch team will look into it and be in touch." };
}
