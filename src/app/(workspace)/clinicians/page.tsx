import { HeaderButton, SummaryHeader, SummaryKpiBand } from "@/components/workspace/summary-parts";
import { TargetsButton } from "@/components/workspace/targets-modal";
import { requireStaff } from "@/lib/auth";
import { computeKpis } from "@/lib/client-summary";
import {
  CLINICIAN_STAGE_LABELS,
  ONBOARDING_STAGES,
  firstSessionsByClinician,
  parseClinicianKpiTargets,
  parseStageTargets,
  toClinicianRow,
  type ClinicianSource,
} from "@/lib/clinician-summary";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/types";
import { saveClinicianTargets } from "./actions";
import { ClinicianTable } from "./clinician-table";

export const metadata = { title: "Clinician summary" };

type One<T> = T | T[] | null;
type MatchRow = { clinician_id: string; families: One<{ status: string }> };
type ConversionRow = { first_session_at: string; matches: One<{ clinician_id: string }> };

async function loadClinicianSummary() {
  const supabase = await createClient();
  const [{ data: clinicians }, { data: matches }, { data: conversions }, { data: settings }] = await Promise.all([
    supabase
      .from("clinicians")
      .select("id, name, email, profession, status, status_changed_at, created_at, application_submitted_at, suburb, postcode")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("matches").select("clinician_id, families(status)").eq("state", "accepted").limit(10000),
    supabase.from("conversions").select("first_session_at, matches(clinician_id)").limit(10000),
    supabase.from("settings").select("key, value").in("key", ["clinician_step_targets_hours", "clinician_kpi_targets"]),
  ]);
  const setting = (key: string) => settings?.find((s: { key: string }) => s.key === key)?.value;
  const stageTargets = parseStageTargets(setting("clinician_step_targets_hours"));
  const kpiTargets = parseClinicianKpiTargets(setting("clinician_kpi_targets"));
  const now = Date.now();

  // An active client is one allocated to the clinician whose first session is confirmed.
  const activeClients = new Map<string, number>();
  for (const m of (matches ?? []) as unknown as MatchRow[]) {
    if (firstOf(m.families)?.status === "converted") activeClients.set(m.clinician_id, (activeClients.get(m.clinician_id) ?? 0) + 1);
  }
  const list = (clinicians ?? []) as ClinicianSource[];
  const rows = list.map((c) => toClinicianRow(c, activeClients.get(c.id) ?? 0, stageTargets, now));
  const inNetwork = list.filter((c) => c.status !== "offboarded");
  const sessions = ((conversions ?? []) as unknown as ConversionRow[]).flatMap((c) => {
    const clinicianId = firstOf(c.matches)?.clinician_id;
    return clinicianId ? [{ clinician_id: clinicianId, first_session_at: c.first_session_at }] : [];
  });
  return {
    rows,
    kpis: computeKpis(inNetwork, firstSessionsByClinician(inNetwork, sessions), now, (c) => (activeClients.get(c.id) ?? 0) > 0),
    stageTargets,
    kpiTargets,
  };
}

export default async function CliniciansPage() {
  const viewer = await requireStaff();
  const { rows, kpis, stageTargets, kpiTargets } = await loadClinicianSummary();
  const onboarding = rows.filter((r) => ONBOARDING_STAGES.includes(r.stage)).length;

  return (
    <div className="flex min-h-full flex-col">
      <SummaryHeader
        label="Clinician Summary"
        count={onboarding}
        countTitle="Clinicians still moving through onboarding"
        actions={
          <>
            <HeaderButton href="/join">New clinician</HeaderButton>
            <TargetsButton
              title="Clinician summary settings"
              stepHelp="Hours a clinician can wait in an onboarding step before it shows in red in the Elapsed column. Leave blank for no target."
              steps={ONBOARDING_STAGES.map((s) => ({ name: `step_${s}`, label: CLINICIAN_STAGE_LABELS[s], unit: "hours", value: stageTargets[s] }))}
              kpis={[
                { name: "total_clinicians", label: "Total clinicians", unit: "clinicians", value: kpiTargets.total_clinicians },
                { name: "active_rate_pct", label: "Active clinicians", unit: "% with an active client", value: kpiTargets.active_rate_pct, max: 100 },
                { name: "signup_to_session_days", label: "Sign up to first session", unit: "days (average)", value: kpiTargets.signup_to_session_days, step: "0.5" },
                { name: "new_signups_7d", label: "New sign ups", unit: "per 7 days", value: kpiTargets.new_signups_7d },
              ]}
              action={saveClinicianTargets}
              canEdit={viewer.role === "admin"}
            />
          </>
        }
      />

      <SummaryKpiBand
        noun="clinicians"
        kpis={kpis}
        targets={{
          total: kpiTargets.total_clinicians,
          activeRatePct: kpiTargets.active_rate_pct,
          signupToSessionDays: kpiTargets.signup_to_session_days,
          newSignups7d: kpiTargets.new_signups_7d,
        }}
        sessionHint={`Average time from a clinician signing up to their first client's first session, for first sessions in the last 90 days (${kpis.signupToSessionCount})`}
      />

      <ClinicianTable rows={rows} canRecordIntake={["admin", "clinical_lead"].includes(viewer.role)} />
    </div>
  );
}
