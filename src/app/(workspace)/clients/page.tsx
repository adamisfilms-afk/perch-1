import { HeaderButton, SummaryHeader, SummaryKpiBand } from "@/components/workspace/summary-parts";
import { TargetsButton } from "@/components/workspace/targets-modal";
import { requireStaff } from "@/lib/auth";
import {
  CLIENT_STATUS_LABELS,
  SETTLED_STATUSES,
  STEP_TARGET_STATUSES,
  computeKpis,
  parseKpiTargets,
  parseStepTargets,
  toClientRow,
} from "@/lib/client-summary";
import type { FamilyStatus, FundingType } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/types";
import { saveClientTargets } from "./actions";
import { ClientTable } from "./client-table";

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
      <SummaryHeader
        label="Client Summary"
        count={inProgress}
        countTitle="Clients still moving through onboarding"
        actions={
          <>
            <HeaderButton href="/enquire">New contact</HeaderButton>
            <TargetsButton
              title="Client summary settings"
              stepHelp="Hours a client can wait in a step before moving on. Longer waits show in red in the Elapsed column and raise the dashboard's stale alerts. Leave blank for no target."
              steps={STEP_TARGET_STATUSES.map((s) => ({ name: `step_${s}`, label: CLIENT_STATUS_LABELS[s], unit: "hours", value: stepTargets[s] }))}
              kpis={[
                { name: "total_clients", label: "Total clients", unit: "clients", value: kpiTargets.total_clients },
                { name: "active_rate_pct", label: "Active clients", unit: "% of all clients", value: kpiTargets.active_rate_pct, max: 100 },
                { name: "signup_to_session_days", label: "Sign up to first session", unit: "days (average)", value: kpiTargets.signup_to_session_days, step: "0.5" },
                { name: "new_signups_7d", label: "New sign ups", unit: "per 7 days", value: kpiTargets.new_signups_7d },
              ]}
              action={saveClientTargets}
              canEdit={viewer.role === "admin"}
            />
          </>
        }
      />

      <SummaryKpiBand
        noun="clients"
        kpis={kpis}
        targets={{
          total: kpiTargets.total_clients,
          activeRatePct: kpiTargets.active_rate_pct,
          signupToSessionDays: kpiTargets.signup_to_session_days,
          newSignups7d: kpiTargets.new_signups_7d,
        }}
        sessionHint={`Average for first sessions in the last 90 days (${kpis.signupToSessionCount})`}
      />

      <ClientTable rows={rows} />
    </div>
  );
}
