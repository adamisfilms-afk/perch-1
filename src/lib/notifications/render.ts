// Fill in message templates. Templates use {{name}} placeholders; see the templates migration.

import {
  CREDENTIALS,
  FUNDING_LABELS,
  PAUSE_LABELS,
  PROFESSION_LABELS,
  SERVICE_LABELS,
  type CredentialType,
  type FundingType,
  type PauseReason,
  type Profession,
  type ServiceType,
} from "../domain";
import { availabilityPath, bookingPath } from "../booking/links";
import { formatDate, formatDateTime } from "../time";

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export interface LinkConfig {
  appUrl: string;
  /** Signs booking and availability links (see src/lib/booking/links.ts). */
  linkSecret: string;
}

/** Adds links and friendly labels to the values stored with the message. */
export function buildVariables(payload: Record<string, unknown>, links: LinkConfig): Record<string, unknown> {
  const v: Record<string, unknown> = { ...payload };
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  v.app_url = links.appUrl;
  v.portal_url = `${links.appUrl}/portal`;
  v.documents_url = `${links.appUrl}/portal/documents`;
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
  if (clinicianId && typeof payload.availability_link_version === "number") {
    v.availability_url = links.appUrl + availabilityPath(links.linkSecret, clinicianId, payload.availability_link_version);
  }
  // Messages about a booked call link back to that booking's page.
  const kind = str("appointment_kind");
  const bookedClinician = str("booked_clinician_id");
  const bookedMatch = str("booked_match_id");
  if (kind === "signup_call" && familyId) v.booking_url = v.intake_booking_url;
  if (kind === "clinician_intake" && bookedClinician) v.booking_url = links.appUrl + bookingPath(links.linkSecret, "clinician_intake", bookedClinician);
  if (kind === "intro_call" && bookedMatch) v.booking_url = links.appUrl + bookingPath(links.linkSecret, "intro_call", bookedMatch);
  if (str("record_path")) v.record_url = links.appUrl + str("record_path");

  if (typeof payload.portal_token_hash === "string") {
    const type = payload.portal_link_type === "recovery" ? "recovery" : "invite";
    v.portal_invite_url = `${links.appUrl}/auth/confirm?token_hash=${encodeURIComponent(payload.portal_token_hash)}&type=${type}`;
  }
  if (typeof payload.match_id === "string") {
    v.offer_url = `${links.appUrl}/portal/offers/${payload.match_id}`;
  }
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
  if (typeof payload.expires_at === "string") v.expires_at_local = formatDate(payload.expires_at);
  return v;
}
