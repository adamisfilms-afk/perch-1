// Dashboard metrics: how fast families move through the funnel, and how the network is doing.
// Pure functions so they can be unit tested; the dashboard page loads the rows.

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

export function fmtDays(v: number | null, unit: string): string {
  return v === null ? "–" : `${Math.round(v * 10) / 10} ${unit}`;
}

export function fmtPct(v: number | null): string {
  return v === null ? "–" : `${v}%`;
}

/** null when there's no data yet, so it shows as neither on nor off target. */
export function check(v: number | null, ok: (v: number) => boolean): boolean | null {
  return v === null ? null : ok(v);
}

export interface Metric {
  label: string;
  value: string;
  target: string;
  ok: boolean | null;
}

export type BreakdownRow = [string, { total: number; converted: number }];

/** Enquiries and conversions grouped by `key`, biggest groups first (top 10). */
export function breakdown<T extends { status: string }>(rows: T[], key: (r: T) => string): BreakdownRow[] {
  const m = new Map<string, { total: number; converted: number }>();
  for (const r of rows) {
    const k = key(r);
    const row = m.get(k) ?? { total: 0, converted: 0 };
    row.total += 1;
    if (r.status === "converted") row.converted += 1;
    m.set(k, row);
  }
  return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
}

export const PERIODS = [30, 90, 180, 365] as const;
