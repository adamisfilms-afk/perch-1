// Booking settings (the `booking` row in public.settings) and shared labels.

export type AppointmentKind = "signup_call" | "clinician_intake" | "intro_call";

export interface BookingSettings {
  signup_call_minutes: number;
  clinician_intake_minutes: number;
  intro_call_minutes: number;
  min_notice_hours: number;
  horizon_days: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  signup_call_minutes: 15,
  clinician_intake_minutes: 30,
  intro_call_minutes: 15,
  min_notice_hours: 12,
  horizon_days: 21,
};

export function parseBookingSettings(value: unknown): BookingSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_BOOKING_SETTINGS };
  for (const k of Object.keys(out) as (keyof BookingSettings)[]) {
    const n = Number(v[k]);
    if (v[k] !== undefined && v[k] !== null && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function minutesFor(kind: AppointmentKind, s: BookingSettings): number {
  return kind === "signup_call" ? s.signup_call_minutes : kind === "clinician_intake" ? s.clinician_intake_minutes : s.intro_call_minutes;
}

export const CALL_LABELS: Record<AppointmentKind, string> = {
  signup_call: "Sign-up call",
  clinician_intake: "Clinician intake call",
  intro_call: "Intro call",
};

/** Time zones people can pick for their weekly hours. */
export const AU_TIMEZONES: [string, string][] = [
  ["Australia/Sydney", "NSW and ACT"],
  ["Australia/Melbourne", "Victoria"],
  ["Australia/Brisbane", "Queensland"],
  ["Australia/Adelaide", "South Australia"],
  ["Australia/Hobart", "Tasmania"],
  ["Australia/Darwin", "Northern Territory"],
  ["Australia/Perth", "Western Australia"],
];

export const WEEKDAYS: [number, string][] = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
];
