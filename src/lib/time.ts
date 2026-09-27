// All times are stored in UTC and shown in Australian local time.
// Staff can also switch on a UK view for London-based founders.

export const AU_TZ = "Australia/Sydney";
export const UK_TZ = "Europe/London";

type Input = string | Date | null | undefined;

function toDate(v: Input): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(v: Input, timeZone = AU_TZ): string {
  const d = toDate(v);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Dates without a time (DOB, expiry dates) are calendar dates: format them without shifting zones. */
export function formatDate(v: string | null | undefined): string {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Today's date in Sydney as YYYY-MM-DD. */
export function todayInAustralia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AU_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function ageFrom(dob: string | null, ageYears: number | null, today = todayInAustralia()): number | null {
  if (!dob) return ageYears;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

function utcDay(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysUntil(date: string, today = todayInAustralia()): number {
  return Math.round((utcDay(date) - utcDay(today)) / 86_400_000);
}

export function hoursSince(v: Input, now = new Date()): number {
  const d = toDate(v);
  return d ? (now.getTime() - d.getTime()) / 3_600_000 : 0;
}

export function relativeHours(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function isoDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function daysSince(v: Input, now = new Date()): number {
  return hoursSince(v, now) / 24;
}
