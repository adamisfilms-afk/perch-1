import Link from "next/link";
import type { ReactNode } from "react";
import { splitDaysHours, type ClientKpis } from "@/lib/client-summary";
import { Sparkline, TickGauge } from "./charts";
import { LinkTabs, type TabDef } from "./tabs";

export interface HeaderTab {
  href: string;
  label: string;
  active?: boolean;
  count?: number;
  countTitle?: string;
}

/**
 * The header of a workspace page: tabs on the left, actions on the right.
 * It uses flex-wrap-reverse so the actions stack above the tabs on phones.
 */
export function PageTabsHeader({ label, tabs, actions }: { label: string; tabs: HeaderTab[]; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap-reverse justify-between gap-x-4 border-b border-neutral-200 px-4 md:px-8">
      {/* Stretches to the header's height with the tabs at the bottom, so the active underline sits on the border. */}
      <nav aria-label={label} className="-mb-px flex items-end gap-6 overflow-x-auto md:gap-10">
        {tabs.map((t) =>
          t.active ? (
            <span key={t.label} aria-current="page" className="flex items-center gap-2 whitespace-nowrap border-b-2 border-neutral-900 py-3 pr-2 text-sm font-medium md:py-3.5">
              {t.label}
              {t.count !== undefined && (
                <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white" title={t.countTitle}>
                  {t.count}
                </span>
              )}
            </span>
          ) : (
            <Link key={t.label} href={t.href} className="whitespace-nowrap border-b-2 border-transparent py-3 text-sm text-neutral-700 hover:text-neutral-900 md:py-3.5">
              {t.label}
            </Link>
          ),
        )}
      </nav>
      {actions && <div className="ml-auto flex items-center gap-2 self-center pt-2 sm:py-2">{actions}</div>}
    </header>
  );
}

/** The header of a summary page: the page itself (the default tab), then an Analytics tab that isn't wired up yet. */
export function SummaryHeader({
  label,
  count,
  countTitle,
  actions,
}: {
  label: string;
  count: number;
  countTitle: string;
  actions: ReactNode;
}) {
  return (
    <PageTabsHeader
      label={label}
      tabs={[
        { href: "#", label, active: true, count, countTitle },
        { href: "#", label: "Analytics" },
      ]}
      actions={actions}
    />
  );
}

/** The header of a full record: back link, name, a line of status, and the record's tabs. */
export function RecordHeader({
  back,
  title,
  subtitle,
  tabs,
  active,
  basePath,
}: {
  back: { href: string; label: string };
  title: ReactNode;
  subtitle?: ReactNode;
  tabs: TabDef[];
  active: string;
  basePath: string;
}) {
  return (
    <header className="border-b border-neutral-200 px-4 pt-4 md:px-8">
      <Link href={back.href} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← {back.label}
      </Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <div className="mt-1 text-sm text-neutral-500">{subtitle}</div>}
      <div className="mt-3">
        <LinkTabs tabs={tabs} active={active} basePath={basePath} label="Record" />
      </div>
    </header>
  );
}

/** The dark button in a summary header (e.g. "New contact"). */
export function HeaderButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-8 items-center whitespace-nowrap rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800">
      {children}
    </Link>
  );
}

/** The grey band of key numbers under the header. */
export function KpiBand({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-x-6 gap-y-5 bg-neutral-100 px-4 py-4 md:gap-x-10 md:px-8 xl:grid-cols-[repeat(4,minmax(0,15rem))]">
      {children}
    </section>
  );
}

export function Kpi({
  label,
  target,
  hint,
  badge,
  children,
}: {
  label: string;
  target: string | null;
  hint?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" title={hint}>
      <h2 className="flex items-center gap-2 whitespace-nowrap text-sm text-neutral-800">
        {label}
        {badge}
      </h2>
      {children}
      {/* Pinned to the bottom of the cell so every target lines up, whatever the chart's height. */}
      {target && <p className="mt-auto text-xs text-neutral-500">Target {target}</p>}
    </div>
  );
}

/** The small ↑/↓ badge comparing this week's sign-ups with last week's. */
export function DeltaBadge({ delta, previous }: { delta: number; previous: number }) {
  if (delta === 0) return null;
  return (
    <span
      className={delta > 0 ? "rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800" : "rounded bg-red-100 px-1 text-[10px] font-medium text-red-800"}
      title={`${previous} the week before`}
    >
      {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}
    </span>
  );
}

export interface SummaryTargets {
  total: number | null;
  activeRatePct: number | null;
  signupToSessionDays: number | null;
  newSignups7d: number | null;
}

/** The four key numbers shared by the client and clinician summaries. `noun` is "clients" or "clinicians". */
export function SummaryKpiBand({ noun, kpis, targets, sessionHint }: { noun: string; kpis: ClientKpis; targets: SummaryTargets; sessionHint: string }) {
    const s2s = kpis.signupToSessionHours === null ? null : splitDaysHours(kpis.signupToSessionHours);
  const s2sDays = kpis.signupToSessionHours === null ? null : kpis.signupToSessionHours / 24;
  const s2sMax = Math.max((targets.signupToSessionDays ?? 7) * 2, (s2sDays ?? 0) * 1.1);
  const delta = kpis.newSignups7d - kpis.newSignupsPrev7d;
  return (
    <KpiBand>
      <Kpi label={`Total ${noun}`} target={targets.total !== null ? `${targets.total}` : null}>
        <p className="text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">{kpis.total}</p>
        <Sparkline values={kpis.totalSeries} target={targets.total} label={`Total ${noun} over the last 90 days, now ${kpis.total}`} />
      </Kpi>

      <Kpi label={`Active ${noun}`} target={targets.activeRatePct !== null ? `${targets.activeRatePct}%` : null}>
        <p className="flex items-start text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">
          {kpis.activeRatePct === null ? "–" : Math.round(kpis.activeRatePct)}
          <span className="ml-1">%</span>
          <span className="ml-3 text-xs font-normal text-neutral-500" title={`Active ${noun}`}>
            {kpis.active}
          </span>
        </p>
        <TickGauge
          value={kpis.activeRatePct}
          max={100}
          target={targets.activeRatePct}
          label={`${Math.round(kpis.activeRatePct ?? 0)}% of ${noun} are active${targets.activeRatePct ? `, target ${targets.activeRatePct}%` : ""}`}
        />
      </Kpi>

      <Kpi
        label="Sign up to session"
        target={targets.signupToSessionDays !== null ? `${targets.signupToSessionDays}d` : null}
        hint={sessionHint}
      >
        <p className="text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">
          {s2s ? (
            <>
              {s2s.days}
              <span className="mr-3 text-base text-neutral-600">d</span>
              {s2s.hours}
              <span className="text-base text-neutral-600">h</span>
            </>
          ) : (
            "–"
          )}
        </p>
        <TickGauge
          value={s2sDays}
          max={s2sMax}
          target={targets.signupToSessionDays}
          label={`Average ${s2sDays?.toFixed(1) ?? "–"} days from sign-up to first session${targets.signupToSessionDays ? `, target ${targets.signupToSessionDays} days` : ""}`}
        />
      </Kpi>

      <Kpi
        label="New sign ups (7d)"
        target={targets.newSignups7d !== null ? `${targets.newSignups7d}` : null}
        badge={<DeltaBadge delta={delta} previous={kpis.newSignupsPrev7d} />}
      >
        <p className="text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">{kpis.newSignups7d}</p>
        <Sparkline values={kpis.newSignupsSeries} target={targets.newSignups7d} label={`New sign ups per week over the last 12 weeks, ${kpis.newSignups7d} this week`} />
      </Kpi>
    </KpiBand>
  );
}
