import "server-only";

// A family's or clinician's activity, for the History tab: every event in the activity log (status changes,
// submissions, bookings, uploads, referrals…) plus the emails and texts we sent them, newest first.
// Reads as the signed-in staff member, so row-level security applies.

import { CLIENT_STATUS_LABELS } from "../client-summary";
import { CLINICIAN_STATUS_LABELS, CREDENTIALS, type ClinicianStatus, type CredentialType, type FamilyStatus } from "../domain";
import type { createClient } from "../supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface ActivityEntry {
  at: string;
  /** What happened. */
  text: string;
  /** A reason or extra detail, if any. */
  note: string | null;
  /** Who did it: a staff member's name, "Clinician", "Family", "Automatic" or "Perch" (for messages we sent). */
  by: string;
  /** "event" for the activity log, "message" for an email or text we sent. */
  source: "event" | "message";
}

type Row = { at: string; kind: string; summary: string; detail: Record<string, unknown>; actor_kind: string; actor_id: string | null };
type Msg = { template: string; channel: string; status: string; scheduled_for: string; sent_at: string | null; last_error: string | null };

const DOC_VERBS: Record<string, string> = {
  document_uploaded: "uploaded",
  document_sighted: "sighted by the team",
  document_verified: "verified",
  document_rejected: "rejected",
  document_expired: "expired",
};

export async function loadActivity(db: Db, entityType: "family" | "clinician", id: string, names: Map<string, string>): Promise<ActivityEntry[]> {
  const [events, messages, templates] = await Promise.all([
    db.from("activity_log").select("at, kind, summary, detail, actor_kind, actor_id").eq("entity_type", entityType).eq("entity_id", id).order("at", { ascending: false }).limit(500),
    db
      .from("message_log")
      .select("template, channel, status, scheduled_for, sent_at, last_error")
      .eq("recipient_kind", entityType)
      .eq("recipient_id", id)
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: false })
      .limit(300),
    db.from("message_templates").select("key, channel, description"),
  ]);

  const statusLabel = (s: unknown) =>
    typeof s !== "string" ? "" : entityType === "family" ? (CLIENT_STATUS_LABELS[s as FamilyStatus] ?? s) : (CLINICIAN_STATUS_LABELS[s as ClinicianStatus] ?? s);
  const by = (r: Row) =>
    r.actor_kind === "staff" ? (r.actor_id ? (names.get(r.actor_id) ?? "Staff") : "Staff") : r.actor_kind === "clinician" ? "Clinician" : r.actor_kind === "family" ? "Family" : "Automatic";

  const fromEvents: ActivityEntry[] = ((events.data ?? []) as Row[]).map((r) => {
    const d = r.detail ?? {};
    const reason = typeof d.reason === "string" && d.reason ? d.reason : null;
    if (r.kind === "status") {
      return { at: r.at, text: `${d.from ? `${statusLabel(d.from)} → ` : ""}${statusLabel(d.to)}`, note: reason, by: by(r), source: "event" };
    }
    if (DOC_VERBS[r.kind] && typeof d.type === "string") {
      const label = CREDENTIALS[d.type as CredentialType]?.label ?? d.type;
      return { at: r.at, text: `${label} ${DOC_VERBS[r.kind]}`, note: reason, by: by(r), source: "event" };
    }
    return { at: r.at, text: r.summary, note: null, by: by(r), source: "event" };
  });

  const described = new Map(
    ((templates.data ?? []) as { key: string; channel: string; description: string | null }[]).map((t) => [
      `${t.key}:${t.channel}`,
      (t.description ?? t.key).replace(/^[^:]+:\s*/, ""),
    ]),
  );
  const fromMessages: ActivityEntry[] = ((messages.data ?? []) as Msg[]).map((m) => {
    const what = m.channel === "sms" ? "Text" : m.channel === "email" ? "Email" : "Message";
    const verb = m.status === "sent" ? "sent" : m.status === "failed" ? "failed to send" : m.status === "skipped" ? "not sent (not set up)" : "sending";
    return {
      at: m.sent_at ?? m.scheduled_for,
      text: `${what} ${verb}: ${described.get(`${m.template}:${m.channel}`) ?? m.template.replaceAll("_", " ")}`,
      note: m.status === "failed" ? m.last_error : null,
      by: "Perch",
      source: "message",
    };
  });

  return [...fromEvents, ...fromMessages].sort((a, b) => b.at.localeCompare(a.at));
}
