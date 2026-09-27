// Business days for the funnel targets ("matched within 5 business days").
// Weekends are skipped. Public holidays vary by state, so they're passed in when known.

import { AU_TZ } from "./time";

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AU_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function isoWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Whole business days between two instants, counted in Sydney time (start day excluded). */
export function businessDaysBetween(start: Date, end: Date, holidays: string[] = []): number {
  let cur = localDate(start);
  const last = localDate(end);
  const skip = new Set(holidays);
  let n = 0;
  while (cur < last) {
    cur = addDay(cur);
    if (isoWeekday(cur) <= 5 && !skip.has(cur)) n += 1;
  }
  return n;
}
