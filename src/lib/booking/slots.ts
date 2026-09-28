// Free booking times, worked out from weekly hours, days off and existing bookings.
// Pure functions (no database), so they can be unit tested. Times go in and out as UTC milliseconds;
// weekly hours are wall-clock times in each host's own time zone, so daylight saving is handled.

export interface WeeklyWindow {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  day: number;
  /** "HH:MM" or "HH:MM:SS", local to the host. */
  start: string;
  end: string;
}

export interface HostSchedule {
  hostId: string;
  timezone: string;
  windows: WeeklyWindow[];
  /** Inclusive local dates, "YYYY-MM-DD". */
  timeOff: { starts_on: string; ends_on: string }[];
  /** Existing bookings, as UTC millisecond ranges. */
  busy: { start: number; end: number }[];
}

export interface SlotOptions {
  minutes: number;
  now: number;
  minNoticeHours: number;
  horizonDays: number;
}

export interface Slot {
  start: number;
  /** Hosts free for the whole call at this time (one for a clinician, possibly several for the team). */
  hostIds: string[];
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** How far `tz` is ahead of UTC at instant `ms`, in milliseconds. */
export function tzOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `tz` (e.g. 2026-10-06 16:00 in Melbourne). */
export function zonedTimeToUtc(ymd: string, hhmm: string, tz: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffset(guess, tz);
  const second = guess - tzOffset(first, tz);
  return second;
}

/** The local date in `tz` for instant `ms`, as "YYYY-MM-DD". */
export function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

function isoWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toHhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** Start times one host is free for a call of `minutes`, on a grid of `minutes` from each window's start. */
export function hostSlots(host: HostSchedule, o: SlotOptions): number[] {
  const earliest = o.now + o.minNoticeHours * 60 * MINUTE;
  const today = localDate(o.now, host.timezone);
  const out: number[] = [];
  for (let n = 0; n <= o.horizonDays; n++) {
    const date = addDays(today, n);
    if (host.timeOff.some((t) => date >= t.starts_on && date <= t.ends_on)) continue;
    const weekday = isoWeekday(date);
    for (const w of host.windows.filter((x) => x.day === weekday)) {
      const end = toMinutes(w.end);
      for (let m = toMinutes(w.start); m + o.minutes <= end; m += o.minutes) {
        const start = zonedTimeToUtc(date, toHhmm(m), host.timezone);
        const finish = start + o.minutes * MINUTE;
        if (start < earliest) continue;
        if (host.busy.some((b) => start < b.end && finish > b.start)) continue;
        out.push(start);
      }
    }
  }
  return out;
}

/** Free start times across several hosts (the Perch team), each with the hosts free then. */
export function availableSlots(hosts: HostSchedule[], o: SlotOptions): Slot[] {
  const byStart = new Map<number, string[]>();
  for (const h of hosts) {
    for (const s of hostSlots(h, o)) byStart.set(s, [...(byStart.get(s) ?? []), h.hostId]);
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, hostIds]) => ({ start, hostIds }));
}

/** Of the hosts free at a time, the one with the fewest upcoming calls (spreads calls across the team). */
export function pickHost(hostIds: string[], upcomingCount: Map<string, number>): string {
  return [...hostIds].sort((a, b) => (upcomingCount.get(a) ?? 0) - (upcomingCount.get(b) ?? 0) || a.localeCompare(b))[0];
}
