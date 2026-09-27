"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { lookupAbn } from "@/lib/abn";
import { CLINICIAN_STATUSES, CREDENTIAL_TYPES, PAUSE_REASONS, type ClinicianStatus, type CredentialType } from "@/lib/domain";
import { env } from "@/lib/env";
import { sendAgreementForSignature } from "@/lib/integrations/documenso";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { parseProfile, saveAvailability } from "@/lib/server/clinician-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ClinicianRow } from "@/lib/types";

const AGREEMENT_VERSION = process.env.AGREEMENT_VERSION ?? "2026-09";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function done(id: string, message: string): ActionState {
  revalidatePath(`/clinicians/${id}`);
  after(drainOutboxQuietly);
  return { ok: true, message };
}

async function load(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("clinicians").select("*").eq("id", id).single<ClinicianRow>();
  return { supabase, clinician: data };
}

export async function updateProfile(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const { supabase, clinician } = await load(id);
  if (!clinician) return { error: "Clinician not found" };
  const { update, error, warning } = await parseProfile(fd, clinician);
  if (error) return { error };
  const { error: dbError } = await supabase.from("clinicians").update(update).eq("id", id);
  if (dbError) return { error: friendlyError(dbError) };
  return done(id, warning ?? "Profile saved");
}

export async function updateAvailability(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const error = await saveAvailability(supabase, id, fd);
  return error ? { error } : done(id, "Times saved");
}

export async function updateScreeningNotes(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("clinicians").update({ screening_notes: text(fd, "screening_notes") }).eq("id", id);
  return error ? { error: friendlyError(error) } : done(id, "Notes saved");
}

export async function changeStatus(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const status = String(fd.get("status")) as ClinicianStatus;
  if (!CLINICIAN_STATUSES.includes(status)) return { error: "Choose a status" };
  const pause = text(fd, "pause_reason");
  if (pause && !(PAUSE_REASONS as readonly string[]).includes(pause)) return { error: "Unknown pause reason" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_clinician_status", {
    p_clinician: id,
    p_status: status,
    p_pause_reason: status === "paused" ? pause : null,
    p_reason: text(fd, "reason"),
  });
  if (error) return { error: friendlyError(error) };
  if (status === "offboarded") await removeAccess(id);
  return done(id, "Status updated");
}

export async function approveGoLive(id: string): Promise<ActionState> {
  await requireStaff(["admin", "clinical_lead"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_clinician", { p_clinician: id });
  return error ? { error: friendlyError(error) } : done(id, "Approved by clinical lead");
}

export async function verifyCredential(clinicianId: string, credentialId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const approve = fd.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_credential", {
    p_credential: credentialId,
    p_approve: approve,
    p_reason: text(fd, "reason"),
    p_expires_at: text(fd, "expires_at"),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/verification");
  done(clinicianId, "");
  // The form disappears once the document is reviewed, so show the result on the page we came from.
  const back = fd.get("return_to") === "verification" ? "/verification" : `/clinicians/${clinicianId}`;
  redirect(`${back}?notice=${approve ? "verified" : "rejected"}`);
}

export async function recordSighted(clinicianId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const type = String(fd.get("type")) as CredentialType;
  if (!CREDENTIAL_TYPES.includes(type)) return { error: "Choose a document" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_sighted_credential", {
    p_clinician: clinicianId,
    p_type: type,
    p_sighted_at: text(fd, "sighted_at"),
    p_expires_at: text(fd, "expires_at"),
    p_number: text(fd, "number"),
    p_notes: text(fd, "notes"),
  });
  return error ? { error: friendlyError(error) } : done(clinicianId, "Recorded as sighted");
}

export async function checkAbn(clinicianId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const { supabase, clinician } = await load(clinicianId);
  const abn = (text(fd, "abn") ?? clinician?.abn ?? "").replace(/\s/g, "");
  if (!abn) return { error: "Enter an ABN" };
  const result = await lookupAbn(abn);
  if (!result) return { error: "ABN Lookup couldn't be reached or the ABN isn't valid. Check the number, or try again later." };
  const { error } = await supabase.rpc("record_abn_check", {
    p_clinician: clinicianId,
    p_abn: result.abn,
    p_active: result.active,
    p_entity_name: result.entityName,
  });
  if (error) return { error: friendlyError(error) };
  return done(clinicianId, result.active ? `Active ABN: ${result.entityName}` : "This ABN is not active");
}

export async function sendAgreement(clinicianId: string): Promise<ActionState> {
  await requireStaff();
  const { supabase, clinician } = await load(clinicianId);
  if (!clinician) return { error: "Clinician not found" };
  const { data: agreement, error } = await supabase
    .from("agreements")
    .insert({ clinician_id: clinicianId, version: AGREEMENT_VERSION })
    .select("id")
    .single();
  if (error || !agreement) return { error: friendlyError(error) };
  const result = await sendAgreementForSignature({ agreementId: agreement.id, name: clinician.name, email: clinician.email });
  if ("documentId" in result) {
    await supabase.from("agreements").update({ documenso_ref: result.documentId, sent_at: new Date().toISOString() }).eq("id", agreement.id);
    return done(clinicianId, "Agreement sent for signature");
  }
  if ("skipped" in result) return done(clinicianId, `${result.skipped}: send the agreement manually, then record the signature below.`);
  await supabase.from("agreements").delete().eq("id", agreement.id);
  return { error: `Documenso: ${result.error}` };
}

/** Fallback when an agreement was signed outside Documenso. */
export async function recordAgreementSigned(clinicianId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const signedAt = text(fd, "signed_at");
  if (!signedAt) return { error: "Enter the date it was signed" };
  const { supabase, clinician } = await load(clinicianId);
  const { data: open } = await supabase
    .from("agreements")
    .select("id")
    .eq("clinician_id", clinicianId)
    .is("signed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const signed = new Date(`${signedAt}T00:00:00+10:00`).toISOString();
  const { error } = open?.length
    ? await supabase.from("agreements").update({ signed_at: signed }).eq("id", open[0].id)
    : await supabase.from("agreements").insert({ clinician_id: clinicianId, version: AGREEMENT_VERSION, signed_at: signed });
  if (error) return { error: friendlyError(error) };
  if (clinician && ["documents_requested", "documents_verified"].includes(clinician.status)) {
    await supabase.rpc("set_clinician_status", { p_clinician: clinicianId, p_status: "agreement_signed", p_reason: "Agreement signed (recorded by staff)" });
  }
  return done(clinicianId, "Signature recorded");
}

/** Creates the clinician's portal login and emails them an invite. */
export async function invitePortal(clinicianId: string): Promise<ActionState> {
  await requireStaff();
  const { supabase, clinician } = await load(clinicianId);
  if (!clinician) return { error: "Clinician not found" };
  if (clinician.user_id) return { error: "They already have a portal account" };
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(clinician.email, { redirectTo: `${env.appUrl()}/auth/confirm` });
  if (error || !data.user) return { error: error?.message ?? "Invite failed" };
  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, role: "clinician", full_name: clinician.name, email: clinician.email });
  if (profileError) return { error: friendlyError(profileError) };
  const { error: linkError } = await supabase.from("clinicians").update({ user_id: data.user.id }).eq("id", clinicianId);
  if (linkError) return { error: friendlyError(linkError) };
  return done(clinicianId, `Invite sent to ${clinician.email}`);
}

async function removeAccess(clinicianId: string): Promise<void> {
  const { clinician } = await load(clinicianId);
  if (!clinician?.user_id) return;
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(clinician.user_id, { ban_duration: "876000h" });
  await admin.from("profiles").update({ active: false }).eq("id", clinician.user_id);
}

export async function updateOffboarding(clinicianId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const flags = ["families_handed_over", "records_retention_confirmed", "access_removed", "final_statement_issued", "direct_debit_cancelled"] as const;
  const update: Record<string, unknown> = { notice_received_at: text(fd, "notice_received_at"), notes: text(fd, "notes") };
  for (const f of flags) update[f] = fd.get(f) === "on";
  update.completed_at = flags.every((f) => update[f]) ? new Date().toISOString() : null;
  const { error } = await supabase.from("offboarding_checklists").upsert({ clinician_id: clinicianId, ...update });
  if (error) return { error: friendlyError(error) };
  if (update.access_removed) await removeAccess(clinicianId);
  return done(clinicianId, update.completed_at ? "Off-boarding complete" : "Checklist saved");
}
