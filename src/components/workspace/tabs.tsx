"use client";

import Link from "next/link";
import { cn } from "../ui";

export interface TabDef {
  id: string;
  label: string;
  /** A red count next to the label (e.g. documents out of date). Hidden when 0. */
  alert?: number;
  alertTitle?: string;
}

const tabClass = (active: boolean) =>
  cn(
    "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 py-2.5 text-sm",
    active ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-600 hover:text-neutral-900",
  );

function Alert({ tab }: { tab: TabDef }) {
  if (!tab.alert) return null;
  return (
    <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white" title={tab.alertTitle}>
      {tab.alert}
    </span>
  );
}

/** Tabs inside a modal: switch in place. */
export function TabBar({ tabs, active, onChange, label }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto border-b border-neutral-200">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => onChange(t.id)} className={tabClass(t.id === active)}>
          {t.label}
          <Alert tab={t} />
        </button>
      ))}
    </div>
  );
}

/** Tabs on a full-record page: each tab is a link (?tab=…, the first tab is the plain page), so it can be bookmarked and shared. */
export function LinkTabs({ tabs, active, basePath, label }: { tabs: TabDef[]; active: string; basePath: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-6 overflow-x-auto">
      {tabs.map((t, i) => (
        <Link key={t.id} href={i === 0 ? basePath : `${basePath}?tab=${t.id}`} aria-current={t.id === active ? "page" : undefined} className={tabClass(t.id === active)}>
          {t.label}
          <Alert tab={t} />
        </Link>
      ))}
    </nav>
  );
}
