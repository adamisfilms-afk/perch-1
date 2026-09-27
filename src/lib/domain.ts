// Shared vocabulary: the enum values used in the database, with the words people see.
// Keep in sync with supabase/migrations/20260925000001_schema.sql.

export const FAMILY_STATUSES = [
  "new",
  "contacted",
  "intake_booked",
  "intake_done",
  "ready_to_match",
  "offered",
  "accepted",
  "intro_booked",
  "intro_done",
  "converted",
  "waitlist",
  "lost",
  "not_suitable",
  "withdrawn",
] as const;
export type FamilyStatus = (typeof FAMILY_STATUSES)[number];

export const FAMILY_STATUS_LABELS: Record<FamilyStatus, string> = {
  new: "New",
  contacted: "Contacted",
  intake_booked: "Intake call booked",
  intake_done: "Intake done",
  ready_to_match: "Ready to match",
  offered: "Offered",
  accepted: "Accepted",
  intro_booked: "Intro call booked",
  intro_done: "Intro done",
  converted: "Converted",
  waitlist: "Waitlist",
  lost: "Lost",
  not_suitable: "Not suitable",
  withdrawn: "Withdrawn",
};

/** The main funnel, in order. The rest are side exits. */
export const FUNNEL_STATUSES: FamilyStatus[] = [
  "new",
  "contacted",
  "intake_booked",
  "intake_done",
  "ready_to_match",
  "offered",
  "accepted",
  "intro_booked",
  "intro_done",
  "converted",
];
export const EXIT_STATUSES: FamilyStatus[] = ["waitlist", "lost", "not_suitable", "withdrawn"];

/** Mirrors private.family_transition_allowed() in the database. */
export const FAMILY_TRANSITIONS: Record<FamilyStatus, FamilyStatus[]> = {
  new: ["contacted", "intake_booked", "intake_done", "lost", "not_suitable", "withdrawn"],
  contacted: ["intake_booked", "intake_done", "lost", "not_suitable", "withdrawn"],
  intake_booked: ["intake_done", "contacted", "lost", "not_suitable", "withdrawn"],
  intake_done: ["ready_to_match", "contacted", "not_suitable", "lost", "withdrawn"],
  ready_to_match: ["offered", "waitlist", "lost", "withdrawn"],
  offered: ["accepted", "ready_to_match", "waitlist", "lost", "withdrawn"],
  accepted: ["intro_booked", "intro_done", "converted", "ready_to_match", "lost", "withdrawn"],
  intro_booked: ["intro_done", "converted", "accepted", "ready_to_match", "lost", "withdrawn"],
  intro_done: ["converted", "ready_to_match", "lost", "withdrawn"],
  waitlist: ["ready_to_match", "offered", "lost", "not_suitable", "withdrawn"],
  lost: ["contacted"],
  not_suitable: ["contacted"],
  withdrawn: ["contacted"],
  converted: [],
};

/** Statuses a coordinator can set by hand (others are driven by bookings, offers and outcomes). */
export const MANUAL_FAMILY_STATUSES: FamilyStatus[] = [
  "contacted",
  "intake_booked",
  "ready_to_match",
  "lost",
  "not_suitable",
  "withdrawn",
];

export const FUNDING_TYPES = [
  "ndis_self_managed",
  "ndis_plan_managed",
  "ndis_agency_managed",
  "private",
  "medicare",
  "unsure",
] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];
export const FUNDING_LABELS: Record<FundingType, string> = {
  ndis_self_managed: "NDIS self-managed",
  ndis_plan_managed: "NDIS plan-managed",
  ndis_agency_managed: "NDIS agency-managed",
  private: "Private",
  medicare: "Medicare plan",
  unsure: "Not sure",
};

export const SERVICE_TYPES = ["speech", "ot", "unsure"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_LABELS: Record<ServiceType, string> = {
  speech: "Speech pathology",
  ot: "Occupational therapy",
  unsure: "Not sure",
};

export const PROFESSIONS = ["speech_pathologist", "occupational_therapist"] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const PROFESSION_LABELS: Record<Profession, string> = {
  speech_pathologist: "Speech pathologist",
  occupational_therapist: "Occupational therapist",
};

export const CONCERNS = [
  "speech_sounds",
  "language",
  "stuttering",
  "social_communication",
  "literacy",
  "feeding",
  "fine_motor",
  "sensory",
  "daily_living",
  "other",
] as const;
export type Concern = (typeof CONCERNS)[number];
export const CONCERN_LABELS: Record<Concern, string> = {
  speech_sounds: "Speech sounds",
  language: "Language",
  stuttering: "Stuttering",
  social_communication: "Social communication",
  literacy: "Literacy",
  feeding: "Feeding",
  fine_motor: "Fine motor skills",
  sensory: "Sensory processing",
  daily_living: "Everyday skills",
  other: "Other",
};
/** The concerns shown on the public enquiry form (per the spec). */
export const ENQUIRY_CONCERNS: Concern[] = [
  "speech_sounds",
  "language",
  "stuttering",
  "social_communication",
  "literacy",
  "feeding",
  "other",
];

export const TIME_BLOCKS = ["after_school", "weekends", "school_hours"] as const;
export type TimeBlock = (typeof TIME_BLOCKS)[number];
export const TIME_BLOCK_LABELS: Record<TimeBlock, string> = {
  after_school: "After school",
  weekends: "Weekends",
  school_hours: "School hours",
};

export const AGE_GROUPS = ["0-2", "3-5", "6-12", "13-17", "18+"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  "0-2": "Under 3",
  "3-5": "3 to 5",
  "6-12": "6 to 12",
  "13-17": "13 to 17",
  "18+": "Adults",
};

export function ageGroupFor(age: number): AgeGroup {
  if (age < 3) return "0-2";
  if (age < 6) return "3-5";
  if (age < 13) return "6-12";
  if (age < 18) return "13-17";
  return "18+";
}

export const SPECIAL_INTERESTS = [
  "stuttering",
  "autism",
  "aac",
  "feeding",
  "literacy",
  "speech_sounds",
  "language",
  "social_communication",
  "early_intervention",
  "adhd",
  "sensory",
  "fine_motor",
] as const;
export const INTEREST_LABELS: Record<string, string> = {
  stuttering: "Stuttering",
  autism: "Autism",
  aac: "AAC (communication devices)",
  feeding: "Feeding",
  literacy: "Literacy",
  speech_sounds: "Speech sounds",
  language: "Language",
  social_communication: "Social communication",
  early_intervention: "Early intervention",
  adhd: "ADHD",
  sensory: "Sensory processing",
  fine_motor: "Fine motor",
};

export const CLINICIAN_STATUSES = [
  "applied",
  "screening",
  "documents_requested",
  "documents_verified",
  "agreement_signed",
  "onboarding",
  "orientation",
  "active",
  "paused",
  "offboarded",
] as const;
export type ClinicianStatus = (typeof CLINICIAN_STATUSES)[number];
export const CLINICIAN_STATUS_LABELS: Record<ClinicianStatus, string> = {
  applied: "Applied",
  screening: "Screening call",
  documents_requested: "Documents requested",
  documents_verified: "Documents verified",
  agreement_signed: "Agreement signed",
  onboarding: "Onboarding",
  orientation: "Orientation",
  active: "Active",
  paused: "Paused",
  offboarded: "Off-boarded",
};

/** Mirrors private.clinician_transition_allowed(). Off-boarding is allowed from anywhere. */
export const CLINICIAN_TRANSITIONS: Record<ClinicianStatus, ClinicianStatus[]> = {
  applied: ["screening", "documents_requested", "offboarded"],
  screening: ["documents_requested", "applied", "offboarded"],
  documents_requested: ["documents_verified", "agreement_signed", "offboarded"],
  documents_verified: ["agreement_signed", "documents_requested", "onboarding", "offboarded"],
  agreement_signed: ["documents_verified", "onboarding", "orientation", "active", "offboarded"],
  onboarding: ["orientation", "active", "offboarded"],
  orientation: ["active", "onboarding", "offboarded"],
  active: ["paused", "offboarded"],
  paused: ["active", "offboarded"],
  offboarded: [],
};

export const PAUSE_REASONS = ["credentials", "clinician_request", "quality", "payment"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
export const PAUSE_LABELS: Record<PauseReason, string> = {
  credentials: "Credentials",
  clinician_request: "Clinician request",
  quality: "Quality",
  payment: "Payment",
};

export const CREDENTIAL_TYPES = [
  "spa_cpsp",
  "ahpra",
  "wwcc",
  "ndis_worker_screening",
  "ndis_orientation",
  "pi_insurance",
  "pl_insurance",
  "abn",
  "medicare_provider",
  "phi_provider",
  "ndis_registration",
  "drivers_licence",
  "car_insurance",
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export interface CredentialInfo {
  label: string;
  /** How staff verify it. */
  verification: string;
  expiryTracked: boolean;
  /** Sighted only: record that it was seen, never store a copy. */
  sightedOnly: boolean;
  /** Link staff use to check a public register, if any. */
  registerUrl?: string;
}

export const CREDENTIALS: Record<CredentialType, CredentialInfo> = {
  spa_cpsp: {
    label: "Speech Pathology Australia CPSP membership",
    verification: "Check the Speech Pathology Australia directory, then tick",
    expiryTracked: true,
    sightedOnly: false,
    registerUrl: "https://www.speechpathologyaustralia.org.au/Public/Shared_Content/Find-a-Speech-Pathologist.aspx",
  },
  ahpra: {
    label: "AHPRA registration",
    verification: "Check the public AHPRA register",
    expiryTracked: true,
    sightedOnly: false,
    registerUrl: "https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx",
  },
  wwcc: {
    label: "Working with Children Check",
    verification: "State online check, where available",
    expiryTracked: true,
    sightedOnly: false,
  },
  ndis_worker_screening: {
    label: "NDIS Worker Screening Check",
    verification: "Check the clearance letter",
    expiryTracked: true,
    sightedOnly: false,
  },
  ndis_orientation: {
    label: "NDIS Worker Orientation Module",
    verification: "Certificate",
    expiryTracked: false,
    sightedOnly: false,
  },
  pi_insurance: {
    label: "Professional indemnity insurance",
    verification: "Certificate of currency",
    expiryTracked: true,
    sightedOnly: false,
  },
  pl_insurance: {
    label: "Public liability insurance",
    verification: "Certificate of currency",
    expiryTracked: true,
    sightedOnly: false,
  },
  abn: {
    label: "ABN",
    verification: "Checked automatically against ABN Lookup",
    expiryTracked: false,
    sightedOnly: false,
  },
  medicare_provider: {
    label: "Medicare provider number",
    verification: "Recorded",
    expiryTracked: false,
    sightedOnly: false,
  },
  phi_provider: {
    label: "Private health insurer provider numbers",
    verification: "Recorded",
    expiryTracked: false,
    sightedOnly: false,
  },
  ndis_registration: {
    label: "NDIS registration",
    verification: "Check the NDIS Commission provider register",
    expiryTracked: true,
    sightedOnly: false,
    registerUrl: "https://www.ndiscommission.gov.au/provider-registration/find-registered-provider",
  },
  drivers_licence: {
    label: "Driver's licence",
    verification: "Sight it and record the date (no copy stored)",
    expiryTracked: true,
    sightedOnly: true,
  },
  car_insurance: {
    label: "Car insurance covering business use",
    verification: "Sight it and record the date (no copy stored)",
    expiryTracked: true,
    sightedOnly: true,
  },
};

/** Mirrors private.required_credential_types(). */
export function requiredCredentialTypes(profession: Profession, homeVisits: boolean): CredentialType[] {
  const base: CredentialType[] = [
    "wwcc",
    "ndis_worker_screening",
    "ndis_orientation",
    "pi_insurance",
    "pl_insurance",
    "abn",
  ];
  base.push(profession === "speech_pathologist" ? "spa_cpsp" : "ahpra");
  if (homeVisits) base.push("drivers_licence", "car_insurance");
  return base;
}

export const GO_LIVE_GAP_LABELS: Record<string, string> = {
  agreement: "Service agreement signed",
  clinical_lead_approval: "Clinical lead approval",
  calcom_intro_url: "Cal.com intro-call link",
  portal_account: "Portal account invited",
  service_area: "Service area (base + radius, or suburbs)",
  age_groups: "Age groups",
  funding_types: "Funding types accepted",
  availability: "Available time blocks",
};

export function goLiveGapLabel(gap: string): string {
  if (gap.startsWith("credential:")) {
    const type = gap.slice("credential:".length) as CredentialType;
    return `${CREDENTIALS[type]?.label ?? type} verified and current`;
  }
  return GO_LIVE_GAP_LABELS[gap] ?? gap;
}

export const MATCH_STATE_LABELS: Record<string, string> = {
  proposed: "On shortlist",
  offered: "Offered",
  accepted: "Accepted",
  declined: "Declined",
  timeout: "Timed out",
  withdrawn: "Withdrawn",
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  coordinator: "Coordinator",
  clinical_lead: "Clinical lead",
  clinician: "Clinician",
};

export const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const REFERRAL_SOURCES = [
  "Google search",
  "Facebook or Instagram",
  "GP or paediatrician",
  "School or childcare",
  "Friend or family",
  "NDIS planner or support coordinator",
  "Other",
];

export const NDIS_REGISTRATION_STATUSES = ["Registered", "In progress", "Not registered", "Interested in support"];
