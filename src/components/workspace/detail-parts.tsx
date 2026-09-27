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

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-neutral-500">{k}</dt>
          <dd className="text-neutral-900">{v ?? <span className="text-neutral-400">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}
