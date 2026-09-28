// Fill in message templates. Templates use {{name}} placeholders; see the templates migration.

import {
  CONCERN_LABELS,
  CREDENTIALS,
  FUNDING_LABELS,
  PAUSE_LABELS,
  PROFESSION_LABELS,
  SERVICE_LABELS,
  TIME_BLOCK_LABELS,
  type Concern,
  type CredentialType,
  type FundingType,
  type PauseReason,
  type Profession,
  type ServiceType,
  type TimeBlock,
} from "../domain";
import { bookingPath, clinicianPath, referralPath } from "../booking/links";
import { formatAuMobile } from "../phone";
import { formatDate, formatDateTime } from "../time";

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export interface LinkConfig {
  appUrl: string;
  /** Signs booking, clinician and referral links (see src/lib/booking/links.ts). */
  linkSecret: string;
}

/** Adds links and friendly labels to the values stored with the message. */
export function buildVariables(payload: Record<string, unknown>, links: LinkConfig): Record<string, unknown> {
  const v: Record<string, unknown> = { ...payload };
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  v.app_url = links.appUrl;
  v.recipient_first_name = str("recipient_first_name") ?? str("parent_first_name") ?? str("clinician_first_name") ?? "there";

  // Booking links: a family's sign-up call, a clinician's intake call, a family's intro call with their clinician.
  const familyId = str("family_id");
  const clinicianId = str("clinician_id");
  const matchId = str("match_id");
  if (familyId) v.intake_booking_url = links.appUrl + bookingPath(links.linkSecret, "signup_call", familyId);
  if (clinicianId) v.screening_booking_url = links.appUrl + bookingPath(links.linkSecret, "clinician_intake", clinicianId);
  if (matchId) {
    v.intro_booking_url = links.appUrl + bookingPath(links.linkSecret, "intro_call", matchId);
    v.calcom_intro_url = v.intro_booking_url; // messages queued before Cal.com was replaced
  }
  // A clinician's private page, and their referral pages (no login). Only in messages to that clinician.
  const version = typeof payload.link_version === "number" ? payload.link_version : typeof payload.availability_link_version === "number" ? payload.availability_link_version : null;
  if (clinicianId && version !== null) {
    v.clinician_url = links.appUrl + clinicianPath(links.linkSecret, clinicianId, version);
    v.availability_url = `${v.clinician_url}#hours`;
    v.documents_url = `${v.clinician_url}#documents`;
    v.portal_url = v.clinician_url; // older templates
    const referralMatch = str("referral_match_id") ?? matchId;
    if (referralMatch) {
      v.referral_url = links.appUrl + referralPath(links.linkSecret, referralMatch, version);
      v.offer_url = v.referral_url; // older templates
    }
    if (str("referral_match_id")) v.record_url = v.referral_url;
  }
  // Messages about a booked call link back to that booking's page.
  const kind = str("appointment_kind");
  const bookedClinician = str("booked_clinician_id");
  const bookedMatch = str("booked_match_id");
  if (kind === "signup_call" && familyId) v.booking_url = v.intake_booking_url;
  if (kind === "clinician_intake" && bookedClinician) v.booking_url = links.appUrl + bookingPath(links.linkSecret, "clinician_intake", bookedClinician);
  if (kind === "intro_call" && bookedMatch) v.booking_url = links.appUrl + bookingPath(links.linkSecret, "intro_call", bookedMatch);
  if (str("record_path")) v.record_url = links.appUrl + str("record_path");

  if (typeof payload.token === "string") {
    v.first_session_url = `${links.appUrl}/r/first-session?token=${payload.token}`;
  }

  if (payload.credential_type) v.credential_label = CREDENTIALS[payload.credential_type as CredentialType]?.label ?? payload.credential_type;
  if (payload.funding_type) v.funding_label = FUNDING_LABELS[payload.funding_type as FundingType] ?? payload.funding_type;
  if (payload.service_type) v.service_label = SERVICE_LABELS[payload.service_type as ServiceType] ?? payload.service_type;
  if (payload.pause_reason) v.pause_label = PAUSE_LABELS[payload.pause_reason as PauseReason] ?? payload.pause_reason;
  if (payload.profession) v.profession_label = PROFESSION_LABELS[payload.profession as Profession] ?? payload.profession;
  if (typeof payload.starts_at === "string") v.starts_at_local = formatDateTime(payload.starts_at);
  if (typeof payload.offer_expires_at === "string") v.offer_expires_at_local = formatDateTime(payload.offer_expires_at);
  if (Array.isArray(payload.concerns)) {
    v.concerns_label = [(payload.concerns as string[]).map((c) => CONCERN_LABELS[c as Concern] ?? c).join(", "), str("concern_other")].filter(Boolean).join(": ");
  }
  if (Array.isArray(payload.preferred_times)) {
    v.times_label = (payload.preferred_times as string[]).map((t) => TIME_BLOCK_LABELS[t as TimeBlock] ?? t).join(", ") || "Flexible";
  }
  if (str("parent_mobile")) v.parent_mobile_label = formatAuMobile(str("parent_mobile"));
  v.referral_summary = lines([
    ["Child", payload.child_age !== undefined && payload.child_age !== null ? `${payload.child_age} years old` : null],
    ["Area", str("suburb")],
    ["Service", v.service_label as string | undefined],
    ["Concerns", v.concerns_label as string | undefined],
    ["Funding", v.funding_label as string | undefined],
    ["Preferred times", v.times_label as string | undefined],
    ["Language", str("language")],
    ["Telehealth", payload.telehealth_ok === true ? "Family is open to telehealth" : null],
  ]);
  if (str("parent_email") || str("parent_mobile")) {
    v.family_details = lines([
      ["Parent or carer", str("parent_name")],
      ["Mobile", v.parent_mobile_label as string | undefined],
      ["Email", str("parent_email")],
      ["Suburb", [str("suburb"), str("postcode")].filter(Boolean).join(" ") || null],
      ["Child", [str("child_first_name"), payload.child_age !== undefined && payload.child_age !== null ? `${payload.child_age} years old` : null].filter(Boolean).join(", ") || null],
      ["Service", v.service_label as string | undefined],
      ["Concerns", v.concerns_label as string | undefined],
      ["Funding", [v.funding_label, str("plan_manager") ? `plan manager: ${str("plan_manager")}` : null].filter(Boolean).join(", ") || null],
      ["Preferred times", v.times_label as string | undefined],
      ["Language", str("language")],
      ["Telehealth", payload.telehealth_ok === true ? "Open to telehealth" : null],
      ["Notes from our sign-up call", str("notes_intake")],
    ]);
  }
  if (typeof payload.expires_at === "string") v.expires_at_local = formatDate(payload.expires_at);
  return v;
}

/** "Label: value" lines, skipping blanks. */
function lines(rows: [string, string | null | undefined][]): string {
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}
