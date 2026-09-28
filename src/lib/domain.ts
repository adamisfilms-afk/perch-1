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

/** Statuses where staff can allocate (or change) a client's clinician. Mirrors public.allocate_clinician(). */
export const ALLOCATABLE_STATUSES: FamilyStatus[] = ["ready_to_match", "waitlist", "offered", "accepted", "intro_booked", "intro_done"];

/** Australian states and territories, as stored in families.state. */
export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;
export type AuState = (typeof AU_STATES)[number];
export const AU_STATE_LABELS: Record<AuState, string> = {
  ACT: "Australian Capital Territory",
  NSW: "New South Wales",
  NT: "Northern Territory",
  QLD: "Queensland",
  SA: "South Australia",
  TAS: "Tasmania",
  VIC: "Victoria",
  WA: "Western Australia",
};

/** Mirrors private.family_transition_allowed() in the database. */
export const FAMILY_TRANSITIONS: Record<FamilyStatus, FamilyStatus[]> = {
  new: ["contacted", "intake_booked", "intake_done", "lost", "not_suitable", "withdrawn"],
  contacted: ["intake_booked", "intake_done", "lost", "not_suitable", "withdrawn"],
  intake_booked: ["intake_done", "contacted", "lost", "not_suitable", "withdrawn"],
  intake_done: ["ready_to_match", "contacted", "not_suitable", "lost", "withdrawn"],
  ready_to_match: ["offered", "accepted", "waitlist", "lost", "withdrawn"],
  offered: ["accepted", "ready_to_match", "waitlist", "lost", "withdrawn"],
  accepted: ["intro_booked", "intro_done", "converted", "ready_to_match", "lost", "withdrawn"],
  intro_booked: ["intro_done", "converted", "accepted", "ready_to_match", "lost", "withdrawn"],
  intro_done: ["converted", "accepted", "ready_to_match", "lost", "withdrawn"],
  waitlist: ["ready_to_match", "offered", "accepted", "lost", "not_suitable", "withdrawn"],
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
/** In the words of the live workflow (see the clinician summary stages). The recruitment steps from documents
 * requested to orientation are no longer used; a clinician still in one can be moved back into the workflow. */
export const CLINICIAN_STATUS_LABELS: Record<ClinicianStatus, string> = {
  applied: "Signed up",
  screening: "Intake call booked",
  documents_requested: "Documents requested (old step)",
  documents_verified: "Documents verified (old step)",
  agreement_signed: "Agreement signed (old step)",
  onboarding: "Onboarding (old step)",
  orientation: "Orientation (old step)",
  active: "Ready",
  paused: "Paused",
  offboarded: "Off-boarded",
};

const OLD_STEP: ClinicianStatus[] = ["applied", "screening", "active", "offboarded"];

/** Mirrors private.clinician_transition_allowed(). Off-boarding is allowed from anywhere. */
export const CLINICIAN_TRANSITIONS: Record<ClinicianStatus, ClinicianStatus[]> = {
  applied: ["screening", "active", "offboarded"],
  screening: ["applied", "active", "offboarded"],
  documents_requested: OLD_STEP,
  documents_verified: OLD_STEP,
  agreement_signed: OLD_STEP,
  onboarding: OLD_STEP,
  orientation: OLD_STEP,
  active: ["paused", "offboarded"],
  paused: ["active", "offboarded"],
  offboarded: [],
};

/** A choice in a clinician's "Move to" list. "ready_intake" records the intake call (which makes them Ready). */
export interface ClinicianMove {
  value: ClinicianStatus | "ready_intake";
  label: string;
}

/**
 * The moves staff can make from a clinician's current step, in the live workflow's words:
 * New / Application complete → Intake call booked → Ready (by recording the intake call) ↔ Paused, and Off-boarded.
 */
export function clinicianMoves(
  c: { status: ClinicianStatus; application_submitted_at: string | null },
  canRecordIntake: boolean,
): ClinicianMove[] {
  const beforeCall = c.application_submitted_at ? "Application complete" : "New";
  const moves: ClinicianMove[] = [];
  if (c.status === "active") moves.push({ value: "paused", label: "Paused" });
  else if (c.status === "paused") moves.push({ value: "active", label: "Ready (reactivate)" });
  else if (c.status !== "offboarded") {
    if (c.status !== "applied") moves.push({ value: "applied", label: `${beforeCall} (intake call not booked)` });
    if (c.status !== "screening") moves.push({ value: "screening", label: "Intake call booked" });
    if (canRecordIntake && c.application_submitted_at) moves.push({ value: "ready_intake", label: "Ready (records the intake call)" });
  }
  if (c.status !== "offboarded") moves.push({ value: "offboarded", label: "Off-boarded" });
  return moves;
}

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
  "cv",
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
  cv: {
    label: "CV",
    verification: "Read it before the intake call",
    expiryTracked: false,
    sightedOnly: false,
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
  age_groups: "Age groups",
  funding_types: "Funding types accepted",
  availability: "Available times for intro calls",
};

/** What a clinician still needs before they can submit their application (see private.application_gaps()). */
export function applicationGapLabel(gap: string): string {
  if (gap.startsWith("document:")) {
    const type = gap.slice("document:".length) as CredentialType;
    return `Upload your ${CREDENTIALS[type]?.label ?? type}`;
  }
  const labels: Record<string, string> = {
    mobile: "Add your mobile number",
    age_groups: "Choose the age groups you see",
    funding_types: "Choose the funding types you accept",
    availability: "Add your available times for intro calls with families",
  };
  return labels[gap] ?? gap;
}

/** Turns "Not ready to go live: credential:wwcc, agreement" (and the application equivalent) into a readable sentence. */
export function explainGapsError(message: string): string {
  const m = message.match(/^(Not ready to go live|Your application isn't complete yet): (.+)$/);
  if (!m) return message;
  const gaps = m[2].split(", ");
  const label = m[1] === "Not ready to go live" ? goLiveGapLabel : applicationGapLabel;
  return `${m[1]}. Still needed: ${gaps.map(label).join("; ")}.`;
}

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
  accepted: "Allocated",
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
