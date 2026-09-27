"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { drainOutbox } from "@/lib/notifications/outbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const admin = () => requireStaff(["admin"]);

export async function saveSetting(key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await admin();
  const raw = String(fd.get("value") ?? "");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw; // plain text settings, e.g. an email address
  }
  if (key === "offer_mode" && !["sequential", "parallel"].includes(value as string)) return { error: "Use sequential or parallel" };
  const supabase = await createClient();
  const { error } = await supabase.from("settings").update({ value, updated_by: viewer.userId, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Saved" };
}

export async function saveTemplate(key: string, channel: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await admin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("message_templates")
    .update({ subject: fd.get("subject") || null, body: String(fd.get("body") ?? ""), updated_by: viewer.userId, updated_at: new Date().toISOString() })
    .eq("key", key)
    .eq("channel", channel);
  if (error) return { error: friendlyError(error) };
  return { ok: true, message: "Template saved" };
}

export async function inviteStaff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await admin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("full_name") ?? "").trim();
  const role = String(fd.get("role"));
  if (!email || !name || !["admin", "coordinator", "clinical_lead"].includes(role)) return { error: "Name, email and role are required" };
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm` });
  if (error || !data.user) return { error: error?.message ?? "Invite failed" };
  const { error: pErr } = await db.from("profiles").insert({ id: data.user.id, role, full_name: name, email });
  if (pErr) return { error: friendlyError(pErr) };
  revalidatePath("/settings");
  return { ok: true, message: `Invite sent to ${email}` };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionState> {
  const viewer = await admin();
  if (userId === viewer.userId) return { error: "You can't deactivate yourself" };
  const db = createAdminClient();
  await db.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true, message: active ? "Reactivated" : "Access removed" };
}

export async function runJob(job: "daily" | "offers" | "outbox"): Promise<ActionState> {
  await admin();
  if (job === "outbox") {
    const r = await drainOutbox(200);
    return { ok: true, message: `Sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}` };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_scheduled_jobs", { p_job: job });
  if (error) return { error: friendlyError(error) };
  after(async () => {
    await drainOutbox(200).catch(() => undefined);
  });
  return { ok: true, message: `Done: ${JSON.stringify(data)}` };
}
