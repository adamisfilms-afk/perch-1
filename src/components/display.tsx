import {
  CLINICIAN_STATUS_LABELS,
  CREDENTIALS,
  FAMILY_STATUS_LABELS,
  MATCH_STATE_LABELS,
  PAUSE_LABELS,
  type ClinicianStatus,
  type CredentialType,
  type FamilyStatus,
  type PauseReason,
} from "@/lib/domain";
import { formatDate, formatDateTime, UK_TZ } from "@/lib/time";
import { Badge } from "./ui";

/** A timestamp in Australian time, with the UK time underneath for staff who ask for it. */
export function When({ at, uk }: { at: string | null | undefined; uk?: boolean }) {
  if (!at) return <span className="text-stone-400">–</span>;
  return (
    <time dateTime={at} className="whitespace-nowrap">
      {formatDateTime(at)}
      {uk && <span className="block text-xs text-stone-500">{formatDateTime(at, UK_TZ)}</span>}
    </time>
  );
}

export function DateOnly({ date }: { date: string | null | undefined }) {
  return date ? <time dateTime={date}>{formatDate(date)}</time> : <span className="text-stone-400">–</span>;
}

const familyTone: Partial<Record<FamilyStatus, "green" | "amber" | "red" | "blue" | "violet" | "neutral">> = {
  new: "blue",
  ready_to_match: "violet",
  offered: "amber",
  accepted: "green",
  intro_booked: "green",
  intro_done: "green",
  converted: "green",
  waitlist: "amber",
  lost: "red",
  not_suitable: "neutral",
  withdrawn: "neutral",
};

export function FamilyStatusBadge({ status }: { status: FamilyStatus }) {
  return <Badge tone={familyTone[status] ?? "neutral"}>{FAMILY_STATUS_LABELS[status] ?? status}</Badge>;
}

export function ClinicianStatusBadge({ status, pauseReason }: { status: ClinicianStatus; pauseReason?: PauseReason | null }) {
  const tone = status === "active" ? "green" : status === "paused" ? "amber" : status === "offboarded" ? "neutral" : "blue";
  return (
    <Badge tone={tone}>
      {CLINICIAN_STATUS_LABELS[status] ?? status}
      {status === "paused" && pauseReason ? `: ${PAUSE_LABELS[pauseReason].toLowerCase()}` : ""}
    </Badge>
  );
}

export function MatchStateBadge({ state }: { state: string }) {
  const tone = state === "accepted" ? "green" : state === "offered" ? "amber" : state === "proposed" ? "violet" : "neutral";
  return <Badge tone={tone}>{MATCH_STATE_LABELS[state] ?? state}</Badge>;
}

export function CredentialStatusBadge({ status, expiresAt, today }: { status: string; expiresAt: string | null; today: string }) {
  if (status === "verified" && expiresAt) {
    const days = Math.round((Date.parse(expiresAt) - Date.parse(today)) / 86_400_000);
    if (days <= 30) return <Badge tone="amber">Expires in {days}d</Badge>;
  }
  const tone = status === "verified" ? "green" : status === "pending" ? "blue" : status === "rejected" || status === "expired" ? "red" : "neutral";
  const label = { verified: "Verified", pending: "Waiting for check", rejected: "Rejected", expired: "Expired", superseded: "Replaced" }[status] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

export function credentialLabel(type: string): string {
  return CREDENTIALS[type as CredentialType]?.label ?? type;
}
