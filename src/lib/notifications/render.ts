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
import { formatDate, formatDateTime } from "../time";

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export interface LinkConfig {
  appUrl: string;
  intakeBookingUrl: string;
}

/** Adds links and friendly labels to the values stored with the message. */
export function buildVariables(payload: Record<string, unknown>, links: LinkConfig): Record<string, unknown> {
  const v: Record<string, unknown> = { ...payload };
  v.app_url = links.appUrl;
  v.portal_url = `${links.appUrl}/portal`;
  v.documents_url = `${links.appUrl}/portal/documents`;

  if (typeof payload.family_id === "string") {
    const url = new URL(links.intakeBookingUrl);
    if (typeof payload.parent_name === "string") url.searchParams.set("name", payload.parent_name);
    // Cal.com passes metadata back in its webhook, so the booking links to the right family.
    url.searchParams.set("metadata[family_id]", payload.family_id);
    v.intake_booking_url = url.toString();
  }
  if (typeof payload.match_id === "string") {
    v.offer_url = `${links.appUrl}/portal/offers/${payload.match_id}`;
  }
  if (typeof payload.token === "string") {
    v.first_session_url = `${links.appUrl}/r/first-session?token=${payload.token}`;
  }
  if (typeof payload.calcom_intro_url === "string" && typeof payload.match_id === "string") {
    const url = new URL(payload.calcom_intro_url);
    url.searchParams.set("metadata[match_id]", payload.match_id);
    if (typeof payload.parent_name === "string") url.searchParams.set("name", payload.parent_name);
    v.calcom_intro_url = url.toString();
  }

  if (payload.credential_type) v.credential_label = CREDENTIALS[payload.credential_type as CredentialType]?.label ?? payload.credential_type;
  if (payload.funding_type) v.funding_label = FUNDING_LABELS[payload.funding_type as FundingType] ?? payload.funding_type;
  if (payload.service_type) v.service_label = SERVICE_LABELS[payload.service_type as ServiceType] ?? payload.service_type;
  if (payload.pause_reason) v.pause_label = PAUSE_LABELS[payload.pause_reason as PauseReason] ?? payload.pause_reason;
  if (payload.profession) v.profession_label = PROFESSION_LABELS[payload.profession as Profession] ?? payload.profession;
  if (payload.geocoded === false) v.geocode_note = "⚠ The suburb couldn't be placed on the map: check it before matching.";
  if (typeof payload.starts_at === "string") v.starts_at_local = formatDateTime(payload.starts_at);
  if (typeof payload.offer_expires_at === "string") v.offer_expires_at_local = formatDateTime(payload.offer_expires_at);
  if (typeof payload.expires_at === "string") v.expires_at_local = formatDate(payload.expires_at);
  return v;
}
