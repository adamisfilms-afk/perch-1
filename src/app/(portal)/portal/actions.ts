"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireClinician } from "@/lib/auth";
import { CREDENTIAL_TYPES, CREDENTIALS, type CredentialType } from "@/lib/domain";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { parseProfile, saveAvailability } from "@/lib/server/clinician-profile";
import { createClient } from "@/lib/supabase/server";
import type { ClinicianRow } from "@/lib/types";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function done(paths: string[], message: string): ActionState {
  for (const p of paths) revalidatePath(p);
  after(drainOutboxQuietly);
  return { ok: true, message };
}

export async function respondToOffer(matchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireClinician();
  const accept = fd.get("decision") === "accept";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_offer", { p_match: matchId, p_accept: accept, p_reason: text(fd, "reason") });
  if (error) return { error: friendlyError(error) };
  after(drainOutboxQuietly);
  revalidatePath("/portal", "layout");
  if (accept) redirect("/portal/families?notice=accepted");
  return { ok: true, message: "Thanks for letting us know. We'll offer it to someone else." };
}

export async function recordIntro(matchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireClinician();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_intro_outcome", { p_match: matchId, p_outcome: fd.get("outcome"), p_reason: text(fd, "reason") });
  if (error) return { error: friendlyError(error) };
  done(["/portal/families"], "");
  redirect(`/portal/families?notice=${fd.get("outcome") === "going_ahead" ? "intro" : "not_going_ahead"}`);
}

export async function confirmFirstSession(matchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireClinician();
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_first_session", { p_match: matchId, p_date: text(fd, "date") });
  if (error) return { error: friendlyError(error) };
  done(["/portal/families"], "");
  redirect("/portal/families?notice=converted");
}

async function me() {
  const viewer = await requireClinician();
  const supabase = await createClient();
  const { data } = await supabase.from("clinicians").select("*").eq("id", viewer.clinicianId).single<ClinicianRow>();
  return { viewer, supabase, clinician: data! };
}

export async function updateMyProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase, clinician } = await me();
  const { update, error, warning } = await parseProfile(fd, clinician);
  if (error) return { error };
  const { error: dbError } = await supabase.from("clinicians").update(update).eq("id", clinician.id);
  return dbError ? { error: friendlyError(dbError) } : done(["/portal/profile"], warning ?? "Profile saved");
}

export async function updateMyAvailability(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase, clinician } = await me();
  const error = await saveAvailability(supabase, clinician.id, fd);
  return error ? { error } : done(["/portal/profile"], "Times saved");
}

export async function confirmYearlyCheck(): Promise<ActionState> {
  const { supabase, clinician } = await me();
  const { error } = await supabase.from("clinicians").update({ last_recredentialed_at: new Date().toISOString() }).eq("id", clinician.id);
  return error ? { error: friendlyError(error) } : done(["/portal/profile", "/portal"], "Thanks, you're all set for another year");
}

/** Step 1 of an upload: a one-time URL so the file goes straight to private storage (never through our server). */
export async function createUploadUrl(type: string, fileName: string): Promise<{ path: string; token: string } | { error: string }> {
  const { supabase, clinician } = await me();
  if (!CREDENTIAL_TYPES.includes(type as CredentialType) || CREDENTIALS[type as CredentialType].sightedOnly) return { error: "Choose a document type" };
  const ext = (fileName.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${clinician.id}/${type}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from("credentials").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Couldn't start the upload" };
  return { path: data.path, token: data.token };
}

/** Step 2: record the uploaded document so it joins the verification queue. */
export async function recordUpload(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase, clinician } = await me();
  const type = String(fd.get("type")) as CredentialType;
  const path = String(fd.get("path") ?? "");
  if (!CREDENTIAL_TYPES.includes(type)) return { error: "Choose a document type" };
  if (!path.startsWith(`${clinician.id}/`)) return { error: "Upload the file first" };
  if (CREDENTIALS[type].expiryTracked && !text(fd, "expires_at")) return { error: "Enter the expiry date shown on the document" };
  const { error } = await supabase.from("credentials").insert({
    clinician_id: clinician.id,
    type,
    number: text(fd, "number"),
    expires_at: text(fd, "expires_at"),
    file_path: path,
  });
  return error ? { error: friendlyError(error) } : done(["/portal/documents"], "Uploaded. We'll check it and let you know.");
}
