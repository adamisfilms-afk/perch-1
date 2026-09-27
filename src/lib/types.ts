// Row shapes for the tables the app reads. Mirrors supabase/migrations/*_schema.sql.
import type {
  ClinicianStatus,
  CredentialType,
  FamilyStatus,
  FundingType,
  PauseReason,
  Profession,
  ServiceType,
  TimeBlock,
} from "./domain";

export interface FamilyRow {
  id: string;
  parent_name: string;
  email: string;
  mobile: string;
  suburb: string;
  postcode: string;
  state: string | null;
  lat: number | null;
  lng: number | null;
  funding_type: FundingType;
  plan_manager: string | null;
  referral_source: string | null;
  status: FamilyStatus;
  status_reason: string | null;
  status_changed_at: string;
  waitlist_reason: string | null;
  waitlist_codes: string[];
  assigned_to: string | null;
  complex_case: boolean;
  created_at: string;
}

export interface PipelineRow {
  id: string;
  parent_name: string;
  suburb: string;
  postcode: string;
  funding_type: FundingType;
  status: FamilyStatus;
  status_reason: string | null;
  status_changed_at: string;
  complex_case: boolean;
  referral_source: string | null;
  created_at: string;
  waitlist_reason: string | null;
  geocoded: boolean;
  child_names: string | null;
  hours_in_status: number;
  stale_limit_hours: number | null;
  is_stale: boolean;
}

export interface ChildRow {
  id: string;
  family_id: string;
  first_name: string;
  dob: string | null;
  age_years: number | null;
  concerns: string[];
  concern_other: string | null;
  service_type: ServiceType;
  preferred_times: TimeBlock[];
  language: string | null;
  gender_preference: "female" | "male" | null;
  telehealth_ok: boolean;
  interests_needed: string[];
  notes_intake: string | null;
}

export interface ClinicianRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  mobile: string | null;
  profession: Profession;
  experience_years: number | null;
  gender: string | null;
  interests: string[];
  age_groups: string[];
  languages: string[];
  suburb: string | null;
  postcode: string | null;
  base_lat: number | null;
  base_lng: number | null;
  radius_km: number | null;
  service_postcodes: string[];
  funding_types: FundingType[];
  ndis_registered: boolean;
  home_visits: boolean;
  telehealth: boolean;
  capacity_new: number;
  snoozed_until: string | null;
  status: ClinicianStatus;
  pause_reason: PauseReason | null;
  status_changed_at: string;
  abn: string | null;
  calcom_intro_url: string | null;
  clinical_lead_approved_at: string | null;
  clinical_lead_approved_by: string | null;
  application: Record<string, unknown>;
  screening_notes: string | null;
  last_recredentialed_at: string | null;
  created_at: string;
}

export interface AvailabilityRow {
  id: string;
  clinician_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CredentialRow {
  id: string;
  clinician_id: string;
  type: CredentialType;
  number: string | null;
  issuer: string | null;
  expires_at: string | null;
  file_path: string | null;
  sighted_only: boolean;
  sighted_at: string | null;
  status: "pending" | "verified" | "rejected" | "expired" | "superseded";
  verified_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  last_checked_at: string | null;
  created_at: string;
}

export interface MatchRow {
  id: string;
  family_id: string;
  child_id: string;
  clinician_id: string;
  state: "proposed" | "offered" | "accepted" | "declined" | "timeout" | "withdrawn";
  rank: number;
  rule_score: number | null;
  score_breakdown: Record<string, number>;
  distance_km: number | null;
  ai_rank: number | null;
  ai_reason: string | null;
  proposed_at: string;
  approved_at: string | null;
  approved_by: string | null;
  offered_at: string | null;
  offer_expires_at: string | null;
  responded_at: string | null;
  response_reason: string | null;
}

export interface OfferSummary {
  match_id: string;
  state: MatchRow["state"];
  offered_at: string;
  offer_expires_at: string;
  responded_at: string | null;
  child_age_years: number;
  suburb: string;
  distance_km: number | null;
  concerns: string[];
  concern_other: string | null;
  service_type: ServiceType;
  funding_type: FundingType;
  preferred_times: TimeBlock[];
  language: string | null;
  telehealth_ok: boolean;
  interests_needed: string[];
}

export interface StatusHistoryRow {
  id: number;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  by: string | null;
  at: string;
}

/** PostgREST returns one-to-one relations as an object and one-to-many as an array. */
export function firstOf<T>(v: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}
