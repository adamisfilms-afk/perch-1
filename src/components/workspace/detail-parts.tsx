import type { ReactNode } from "react";

// Building blocks for the details modals on the summary pages.

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

/** Label and value side by side, one per row, so a record reads down the page. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-neutral-100 text-sm">
      {items.map(([k, v], n) => (
        <div key={`${n}-${k}`} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-4 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <dt className="text-neutral-500">{k}</dt>
          <dd className="break-words text-neutral-900">{v ?? <span className="text-neutral-400">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

export interface Booking {
  id: string;
  /** e.g. "Sign-up call", "Intro call", "First session". */
  kind: string;
  at: string;
  /** Who it's with, if anyone. */
  with: string | null;
  /** Outcome or notes, if recorded. */
  detail: string | null;
  /** Date only (no time of day), e.g. a first session. */
  dateOnly?: boolean;
}

/** Upcoming bookings first (soonest first), then past ones (most recent first). */
export function BookingList({ bookings, now, formatAt }: { bookings: Booking[]; now: number; formatAt: (b: Booking) => string }) {
  const upcoming = bookings.filter((b) => Date.parse(b.at) >= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const past = bookings.filter((b) => Date.parse(b.at) < now).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const list = (items: Booking[]) => (
    <ul className="divide-y divide-neutral-100 text-sm">
      {items.map((b) => (
        <li key={b.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-4 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <span className="text-neutral-500">{formatAt(b)}</span>
          <span>
            <span className="text-neutral-900">
              {b.kind}
              {b.with && <span className="text-neutral-500"> · {b.with}</span>}
            </span>
            {b.detail && <span className="block whitespace-pre-line text-neutral-500">{b.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-8">
      <Section title="Upcoming">{upcoming.length ? list(upcoming) : <Empty>Nothing booked.</Empty>}</Section>
      <Section title="Past">{past.length ? list(past) : <Empty>No past bookings.</Empty>}</Section>
    </div>
  );
}
