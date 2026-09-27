"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { friendlyError, requireStaff } from "@/lib/auth";
import { AU_STATES, CONCERNS, FAMILY_STATUSES, FUNDING_TYPES, SERVICE_TYPES, TIME_BLOCKS, type FamilyStatus } from "@/lib/domain";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { normaliseAuMobile } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { ChildRow, FamilyRow } from "@/lib/types";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const list = (fd: FormData, k: string, allowed?: readonly string[]) =>
  fd.getAll(k).filter((v): v is string => typeof v === "string" && (!allowed || allowed.includes(v)));

/** For actions that move the family on (the form that was used disappears): reload with a notice. */
function doneAndShow(familyId: string, notice: string): never {
  revalidatePath(`/families/${familyId}`);
  after(drainOutboxQuietly);
  redirect(`/families/${familyId}?notice=${notice}`);
}

function done(familyId: string, message: string): ActionState {
  revalidatePath(`/families/${familyId}`);
  after(drainOutboxQuietly);
  return { ok: true, message };
}

export async function updateFamily(familyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { data: current } = await supabase.from("families").select("*").eq("id", familyId).single<FamilyRow>();
  if (!current) return { error: "Family not found" };

  const mobile = normaliseAuMobile(String(fd.get("mobile") ?? ""));
  if (!mobile) return { error: "Enter an Australian mobile number" };
  const postcode = String(fd.get("postcode") ?? "").trim();
  if (!/^\d{4}$/.test(postcode)) return { error: "Enter a 4-digit postcode" };
  const suburb = text(fd, "suburb");
  const funding = String(fd.get("funding_type"));
  if (!suburb || !(FUNDING_TYPES as readonly string[]).includes(funding)) return { error: "Suburb and funding are required" };
  const state = String(fd.get("state") ?? "");
  if (!(AU_STATES as readonly string[]).includes(state)) return { error: "Choose a state" };

  const update: Partial<FamilyRow> = {
    parent_name: text(fd, "parent_name") ?? current.parent_name,
    email: (text(fd, "email") ?? current.email).toLowerCase(),
    mobile,
    suburb,
    postcode,
    state,
    funding_type: funding as FamilyRow["funding_type"],
    plan_manager: text(fd, "plan_manager"),
    complex_case: fd.get("complex_case") === "on",
  };
  const { error } = await supabase.from("families").update(update).eq("id", familyId);
  if (error) return { error: friendlyError(error) };
  return done(familyId, "Saved");
}

function childFields(fd: FormData): Partial<ChildRow> {
  const age = text(fd, "age_years");
  return {
    first_name: text(fd, "first_name") ?? undefined,
    last_name: text(fd, "last_name"),
    dob: text(fd, "dob"),
    age_years: age === null ? null : Number(age),
    concerns: list(fd, "concerns", CONCERNS),
    concern_other: text(fd, "concern_other"),
    service_type: (SERVICE_TYPES as readonly string[]).includes(String(fd.get("service_type")))
      ? (fd.get("service_type") as ChildRow["service_type"])
      : undefined,
    preferred_times: list(fd, "preferred_times", TIME_BLOCKS) as ChildRow["preferred_times"],
    language: text(fd, "language"),
    gender_preference: (["female", "male"].includes(String(fd.get("gender_preference"))) ? fd.get("gender_preference") : null) as ChildRow["gender_preference"],
    telehealth_ok: fd.get("telehealth_ok") === "on",
    interests_needed: list(fd, "interests_needed"),
    notes_intake: text(fd, "notes_intake"),
  };
}

export async function updateChild(childId: string, familyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const fields = childFields(fd);
  if (fields.dob === null && fields.age_years === null) return { error: "Enter an age or a date of birth" };
  const { error } = await supabase.from("children").update(fields).eq("id", childId);
  if (error) return { error: friendlyError(error) };
  return done(familyId, "Saved");
}

export async function changeStatus(familyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const status = String(fd.get("status")) as FamilyStatus;
  if (!FAMILY_STATUSES.includes(status)) return { error: "Choose a status" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_family_status", { p_family: familyId, p_status: status, p_reason: text(fd, "reason") });
  if (error) return { error: friendlyError(error) };
  doneAndShow(familyId, "status");
}

export async function completeIntake(familyId: string, childId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const outcome = String(fd.get("outcome"));
  if (!["ready_to_match", "not_suitable", "needs_follow_up"].includes(outcome)) return { error: "Choose an outcome" };
  const supabase = await createClient();

  // Match-relevant answers go straight onto the child and family records.
  const child = childFields(fd);
  delete child.first_name;
  delete child.last_name;
  const funding = String(fd.get("funding_type"));
  if (outcome === "ready_to_match" && (funding === "unsure" || child.service_type === "unsure")) {
    return { error: "Confirm the service type and funding before marking Ready to match" };
  }
  const { error: childError } = await supabase.from("children").update(child).eq("id", childId);
  if (childError) return { error: friendlyError(childError) };
  const { error: famError } = await supabase
    .from("families")
    .update({
      funding_type: (FUNDING_TYPES as readonly string[]).includes(funding) ? funding : undefined,
      plan_manager: text(fd, "plan_manager"),
      complex_case: fd.get("complex_case") === "on",
    })
    .eq("id", familyId);
  if (famError) return { error: friendlyError(famError) };

  const answers = {
    needs: text(fd, "needs"),
    history: text(fd, "history"),
    diagnoses: text(fd, "diagnoses"),
    ndis_funding_available: text(fd, "ndis_funding_available"),
    ndis_plan_end: text(fd, "ndis_plan_end"),
    home_access: text(fd, "home_access"),
    other_preferences: text(fd, "other_preferences"),
  };
  const { error } = await supabase.rpc("complete_intake", {
    p_family: familyId,
    p_outcome: outcome,
    p_answers: answers,
    p_notes: text(fd, "intake_notes"),
    p_reason: text(fd, "outcome_reason"),
  });
  if (error) return { error: friendlyError(error) };
  doneAndShow(familyId, `intake_${outcome}`);
}

/** For when no clinician can take the family yet. Allocating a clinician later moves them straight on. */
export async function moveToWaitlist(familyId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_waitlist", { p_family: familyId, p_reason: "No clinician available yet", p_codes: [] });
  if (error) return { error: friendlyError(error) };
  doneAndShow(familyId, "waitlist");
}

export async function recordIntroOnBehalf(familyId: string, matchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_intro_outcome", {
    p_match: matchId,
    p_outcome: fd.get("outcome"),
    p_reason: text(fd, "reason"),
  });
  if (error) return { error: friendlyError(error) };
  doneAndShow(familyId, "intro");
}

export async function confirmFirstSessionOnBehalf(familyId: string, matchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_first_session", { p_match: matchId, p_date: text(fd, "date") });
  if (error) return { error: friendlyError(error) };
  doneAndShow(familyId, "converted");
}
