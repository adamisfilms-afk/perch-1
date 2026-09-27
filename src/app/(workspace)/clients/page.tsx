import Link from "next/link";
import { Sparkline, TickGauge } from "@/components/workspace/charts";
import { requireStaff } from "@/lib/auth";
import {
  SETTLED_STATUSES,
  computeKpis,
  parseKpiTargets,
  parseStepTargets,
  splitDaysHours,
  toClientRow,
  type ClientKpis,
  type KpiTargets,
} from "@/lib/client-summary";
import type { FamilyStatus, FundingType } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/types";
import { ClientTable } from "./client-table";
import { TargetsButton } from "./targets-modal";

export const metadata = { title: "Client summary" };

type FamilyListRow = {
  id: string;
  parent_name: string;
  status: FamilyStatus;
  status_changed_at: string;
  created_at: string;
  state: string | null;
  suburb: string;
  funding_type: FundingType;
  children: { first_name: string; last_name: string | null }[] | null;
};

type ConversionRow = {
  first_session_at: string;
  matches: { families: { created_at: string } | { created_at: string }[] | null } | { families: { created_at: string } | { created_at: string }[] | null }[] | null;
};

async function loadClientSummary() {
  const supabase = await createClient();
  const [{ data: families }, { data: conversions }, { data: settings }] = await Promise.all([
    supabase
      .from("families")
      .select("id, parent_name, status, status_changed_at, created_at, state, suburb, funding_type, children(first_name, last_name)")
      .is("anonymised_at", null)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("conversions").select("first_session_at, matches(families(created_at))").limit(5000),
    supabase.from("settings").select("key, value").in("key", ["stale_limits_hours", "client_kpi_targets"]),
  ]);
  const setting = (key: string) => settings?.find((s: { key: string }) => s.key === key)?.value;
  const stepTargets = parseStepTargets(setting("stale_limits_hours"));
  const kpiTargets = parseKpiTargets(setting("client_kpi_targets"));
  const now = Date.now();
  const list = (families ?? []) as FamilyListRow[];
  const firstSessions = ((conversions ?? []) as unknown as ConversionRow[]).flatMap((c) => {
    const family = firstOf(firstOf(c.matches)?.families);
    return family ? [{ created_at: family.created_at, first_session_at: c.first_session_at }] : [];
  });
  return {
    rows: list.map((f) => toClientRow(f, stepTargets, now)),
    kpis: computeKpis(list, firstSessions, now),
    stepTargets,
    kpiTargets,
  };
}

export default async function ClientsPage() {
  const viewer = await requireStaff();
  const { rows, kpis, stepTargets, kpiTargets } = await loadClientSummary();
  const inProgress = rows.filter((r) => !SETTLED_STATUSES.includes(r.status)).length;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap-reverse items-end justify-between gap-x-4 border-b border-neutral-200 px-4 md:px-8">
        <nav aria-label="Clients" className="-mb-px flex gap-6 overflow-x-auto md:gap-10">
          <Link href="/dashboard" className="whitespace-nowrap border-b-2 border-transparent py-3 text-sm text-neutral-700 hover:text-neutral-900 md:py-3.5">
            Dashboard
          </Link>
          <span aria-current="page" className="flex items-center gap-2 whitespace-nowrap border-b-2 border-neutral-900 py-3 pr-2 text-sm font-medium md:py-3.5">
            Client Summary
            <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white" title="Clients still moving through onboarding">
              {inProgress}
            </span>
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-2 pt-2 sm:py-2">
          <Link href="/enquire" className="inline-flex min-h-8 items-center whitespace-nowrap rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800">
            New contact
          </Link>
          <TargetsButton stepTargets={stepTargets} kpiTargets={kpiTargets} canEdit={viewer.role === "admin"} />
        </div>
      </header>

      <KpiBand kpis={kpis} targets={kpiTargets} />

      <ClientTable rows={rows} />
    </div>
  );
}

function KpiBand({ kpis, targets }: { kpis: ClientKpis; targets: KpiTargets }) {
  const s2s = kpis.signupToSessionHours === null ? null : splitDaysHours(kpis.signupToSessionHours);
  const s2sDays = kpis.signupToSessionHours === null ? null : kpis.signupToSessionHours / 24;
  const s2sMax = Math.max((targets.signup_to_session_days ?? 7) * 2, (s2sDays ?? 0) * 1.1);
  const delta = kpis.newSignups7d - kpis.newSignupsPrev7d;
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-x-6 gap-y-5 bg-neutral-100 px-4 py-4 md:gap-x-10 md:px-8 xl:grid-cols-[repeat(4,minmax(0,15rem))]">
      <Kpi label="Total clients" target={targets.total_clients !== null ? `${targets.total_clients}` : null}>
        <p className="text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">{kpis.total}</p>
        <Sparkline values={kpis.totalSeries} target={targets.total_clients} label={`Total clients over the last 90 days, now ${kpis.total}`} />
      </Kpi>

      <Kpi label="Active clients" target={targets.active_rate_pct !== null ? `${targets.active_rate_pct}%` : null}>
        <p className="flex items-start text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">
          {kpis.activeRatePct === null ? "–" : Math.round(kpis.activeRatePct)}
          <span className="ml-1">%</span>
          <span className="ml-3 text-xs font-normal text-neutral-500" title="Active clients">
            {kpis.active}
          </span>
        </p>
        <TickGauge
          value={kpis.activeRatePct}
          max={100}
          target={targets.active_rate_pct}
          label={`${Math.round(kpis.activeRatePct ?? 0)}% of clients are active${targets.active_rate_pct ? `, target ${targets.active_rate_pct}%` : ""}`}
        />
      </Kpi>

      <Kpi
        label="Sign up to session"
        target={targets.signup_to_session_days !== null ? `${targets.signup_to_session_days}d` : null}
        hint={`Average for first sessions in the last 90 days (${kpis.signupToSessionCount})`}
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
          target={targets.signup_to_session_days}
          label={`Average ${s2sDays?.toFixed(1) ?? "–"} days from sign-up to first session${targets.signup_to_session_days ? `, target ${targets.signup_to_session_days} days` : ""}`}
        />
      </Kpi>

      <Kpi
        label="New sign ups (7d)"
        target={targets.new_signups_7d !== null ? `${targets.new_signups_7d}` : null}
        badge={
          delta !== 0 ? (
            <span
              className={delta > 0 ? "rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800" : "rounded bg-red-100 px-1 text-[10px] font-medium text-red-800"}
              title={`${kpis.newSignupsPrev7d} the week before`}
            >
              {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}
            </span>
          ) : null
        }
      >
        <p className="text-3xl sm:text-4xl font-medium tracking-tight tabular-nums">{kpis.newSignups7d}</p>
        <Sparkline values={kpis.newSignupsSeries} target={targets.new_signups_7d} label={`New sign ups per week over the last 12 weeks, ${kpis.newSignups7d} this week`} />
      </Kpi>
    </section>
  );
}

function Kpi({
  label,
  target,
  hint,
  badge,
  children,
}: {
  label: string;
  target: string | null;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" title={hint}>
      <h2 className="flex items-center gap-2 whitespace-nowrap text-sm text-neutral-800">
        {label}
        {badge}
      </h2>
      {children}
      {target && <p className="-mt-1 text-xs text-neutral-500">Target {target}</p>}
    </div>
  );
}
