import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { env } from "../env";
import { buildVariables, renderTemplate } from "./render";
import { sendEmail, sendSlack, sendSms, type SendResult } from "./providers";
import { firstOf } from "../types";

interface QueuedMessage {
  id: string;
  template: string;
  channel: "email" | "sms" | "slack";
  recipient: string;
  recipient_kind: "family" | "clinician" | "staff";
  recipient_id: string | null;
  payload: Record<string, unknown>;
}

interface Template {
  key: string;
  channel: string;
  subject: string | null;
  body: string;
}

/**
 * Scheduled messages can go stale between being queued and being due
 * (a reminder for a call that was cancelled, a nudge for an offer already answered).
 */
async function stillRelevant(db: SupabaseClient, m: QueuedMessage): Promise<string | null> {
  const matchId = m.payload.match_id as string | undefined;
  switch (m.template) {
    case "offer_nudge": {
      const { data } = await db.from("matches").select("state").eq("id", matchId).maybeSingle();
      return data?.state === "offered" ? null : "Offer already answered";
    }
    case "first_session_check": {
      const { data } = await db.from("matches").select("state, conversions(id)").eq("id", matchId).maybeSingle();
      if (!data || data.state !== "accepted") return "Referral no longer active";
      return firstOf(data.conversions as unknown) ? "First session already confirmed" : null;
    }
    case "intake_reminder": {
      const { data } = await db.from("families").select("status").eq("id", m.recipient_id).maybeSingle();
      return data?.status === "intake_booked" ? null : "Intake call no longer booked";
    }
    case "intro_reminder":
    case "intro_reminder_clinician": {
      const { data } = await db
        .from("intro_calls")
        .select("id")
        .eq("scheduled_at", m.payload.starts_at as string)
        .limit(1);
      return data?.length ? null : "Intro call rescheduled or cancelled";
    }
    default:
      return null;
  }
}

/** Send everything that's due. Safe to run concurrently: rows are claimed with SKIP LOCKED. */
export async function drainOutbox(limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = createAdminClient();
  const { data: claimed, error } = await db.rpc("claim_messages", { p_limit: limit });
  if (error) throw new Error(`Could not claim messages: ${error.message}`);
  const messages = (claimed ?? []) as QueuedMessage[];
  const tally = { sent: 0, skipped: 0, failed: 0 };
  if (!messages.length) return tally;

  const { data: templates } = await db.from("message_templates").select("key, channel, subject, body");
  const byKey = new Map((templates as Template[] | null)?.map((t) => [`${t.key}:${t.channel}`, t]));
  const links = { appUrl: env.appUrl(), intakeBookingUrl: env.calcomIntakeUrl() };

  for (const m of messages) {
    let result: SendResult;
    const template = byKey.get(`${m.template}:${m.channel}`);
    const stale = await stillRelevant(db, m);
    if (stale) {
      result = { status: "skipped", reason: stale };
    } else if (!template) {
      result = { status: "skipped", reason: `No ${m.channel} template for ${m.template}` };
    } else {
      const vars = buildVariables(m.payload, links);
      const body = renderTemplate(template.body, vars);
      if (m.channel === "email") result = await sendEmail(m.recipient, renderTemplate(template.subject ?? "", vars), body);
      else if (m.channel === "sms") result = await sendSms(m.recipient, body);
      else result = await sendSlack(body);
    }
    await db.rpc("complete_message", {
      p_id: m.id,
      p_status: result.status,
      p_error: result.status === "failed" ? result.error : result.status === "skipped" ? result.reason : null,
      p_provider_ref: result.status === "sent" ? (result.providerRef ?? null) : null,
    });
    tally[result.status] += 1;
  }
  return tally;
}

/** Fire-and-forget after a user action so messages go out straight away, not on the next cron tick. */
export async function drainOutboxQuietly(): Promise<void> {
  try {
    await drainOutbox(20);
  } catch (e) {
    console.error("Outbox drain failed; the cron job will retry", e);
  }
}
