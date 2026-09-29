"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { friendlyError } from "@/lib/auth";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { resolveReferralLink } from "@/lib/server/clinician-link";
import { createAdminClient } from "@/lib/supabase/admin";

// The token is bound in on the server and re-checked on every action.

const EXPIRED = "This link has expired. Ask the Perch team for a new one.";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function done(token: string, message: string): ActionState {
  revalidatePath(`/referral/${token}`);
  after(drainOutboxQuietly);
  return { ok: true, message };
}

export async function respond(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveReferralLink(token);
  if (!link) return { error: EXPIRED };
  const accept = fd.get("decision") === "accept";
  const { error } = await createAdminClient("clinician").rpc("respond_to_referral", { p_match: link.matchId, p_accept: accept, p_reason: text(fd, "reason") });
  if (error) return { error: friendlyError(error) };
  return done(
    token,
    accept
      ? "Thanks for accepting! We've emailed you the family's details, and sent them a link to book an intro call with you."
      : "Thanks for letting us know. We'll find the family another clinician.",
  );
}

export async function recordIntro(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveReferralLink(token);
  if (!link) return { error: EXPIRED };
  const outcome = fd.get("outcome");
  if (outcome !== "going_ahead" && outcome !== "not_going_ahead") return { error: "Choose how the intro call went" };
  const { error } = await createAdminClient("clinician").rpc("record_intro_outcome", { p_match: link.matchId, p_outcome: outcome, p_reason: text(fd, "reason") });
  if (error) return { error: friendlyError(error) };
  return done(
    token,
    outcome === "going_ahead" ? "Saved. Let us know once the first session is booked." : "Thanks for letting us know. We'll find the family another clinician.",
  );
}

export async function confirmFirstSession(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const link = await resolveReferralLink(token);
  if (!link) return { error: EXPIRED };
  const { error } = await createAdminClient("clinician").rpc("confirm_first_session", { p_match: link.matchId, p_date: text(fd, "date") });
  if (error) return { error: friendlyError(error) };
  return done(token, "Great, first session confirmed. From here the family is managed in your Halaxy.");
}
