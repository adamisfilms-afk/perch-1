"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { AGREEMENT_VERSION } from "@/lib/agreement";
import { friendlyError } from "@/lib/auth";
import { parseWindows } from "@/lib/booking/windows";
import { CREDENTIAL_TYPES, CREDENTIALS, explainGapsError, type CredentialType } from "@/lib/domain";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { currentClinicianId, endClinicianSession } from "@/lib/server/clinician-session";
import { parseProfile } from "@/lib/server/clinician-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClinicianRow } from "@/lib/types";

// Every action checks the clinician's sign-in on this device (an emailed code: see clinician-session.ts).
// They have no database login, so these use the service role and only ever touch the signed-in clinician's record.

const SIGNED_OUT = "You've been signed out. Refresh the page and sign in again.";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function saved(message?: string): ActionState {
  revalidatePath("/clinician");
  return { ok: true, message };
}

export async function saveProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const db = createAdminClient();
  const { data: clinician } = await db.from("clinicians").select("*").eq("id", clinicianId).single<ClinicianRow>();
  if (!clinician) return { error: SIGNED_OUT };
  const { update, error, warning } = await parseProfile(fd, clinician);
  if (error) return { error };
  const { error: dbError } = await db.from("clinicians").update(update).eq("id", clinician.id);
  return dbError ? { error: friendlyError(dbError) } : saved(warning ?? "Profile saved");
}

export async function saveHours(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const parsed = parseWindows(fd);
  if ("error" in parsed) return { error: parsed.error };
  const { error } = await createAdminClient().rpc("save_clinician_availability", {
    p_clinician: clinicianId,
    p_timezone: String(fd.get("timezone") ?? "Australia/Sydney"),
    p_windows: parsed.windows,
  });
  if (error) return { error: friendlyError(error) };
  return saved("Saved. Families will see these times when they book.");
}

export async function addDaysOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const starts = String(fd.get("starts_on") ?? "");
  const ends = String(fd.get("ends_on") ?? "") || starts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return { error: "Choose the first and last day off" };
  const { error } = await createAdminClient().rpc("add_time_off", {
    p_profile: null,
    p_clinician: clinicianId,
    p_starts: starts,
    p_ends: ends,
    p_note: String(fd.get("note") ?? ""),
  });
  return error ? { error: friendlyError(error) } : saved();
}

export async function removeDaysOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const { error } = await createAdminClient().rpc("remove_time_off", { p_id: String(fd.get("id")), p_clinician: clinicianId });
  return error ? { error: friendlyError(error) } : saved();
}

/** Step 1 of an upload: a one-time URL so the file goes straight to private storage (never through our server). */
export async function createUploadUrl(type: string, fileName: string): Promise<{ path: string; token: string } | { error: string }> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  if (!CREDENTIAL_TYPES.includes(type as CredentialType) || CREDENTIALS[type as CredentialType].sightedOnly) return { error: "Choose a document type" };
  const ext = (fileName.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${clinicianId}/${type}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("credentials").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Couldn't start the upload" };
  return { path: data.path, token: data.token };
}

/** Step 2: record the uploaded document so it joins the verification queue. */
export async function recordUpload(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const { error } = await createAdminClient().rpc("record_clinician_upload", {
    p_clinician: clinicianId,
    p_type: String(fd.get("type")),
    p_number: text(fd, "number"),
    p_expires_at: text(fd, "expires_at"),
    p_path: String(fd.get("path") ?? ""),
  });
  return error ? { error: friendlyError(error) } : saved("Uploaded. We'll check it and let you know.");
}

/** Submit the application (accepting the service agreement). The database checks it's complete. */
export async function submitApplication(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  if (fd.get("agree") !== "on") return { error: "Please tick to accept the service agreement" };
  const { error } = await createAdminClient().rpc("submit_clinician_application", {
    p_clinician: clinicianId,
    p_agreement_version: AGREEMENT_VERSION,
  });
  if (error) return { error: explainGapsError(friendlyError(error)) };
  after(drainOutboxQuietly);
  return saved("Application submitted. Thanks! We'll check your documents before we make you live.");
}

export async function confirmDetails(): Promise<ActionState> {
  const clinicianId = await currentClinicianId();
  if (!clinicianId) return { error: SIGNED_OUT };
  const { error } = await createAdminClient().rpc("confirm_clinician_details", { p_clinician: clinicianId });
  return error ? { error: friendlyError(error) } : saved("Thanks, you're all set for another year");
}

export async function signOut(): Promise<void> {
  await endClinicianSession();
  redirect("/clinician");
}
