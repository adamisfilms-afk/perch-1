import Link from "next/link";
import { PageTabsHeader } from "@/components/workspace/summary-parts";
import { cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { businessDaysBetween } from "@/lib/business-days";
import { FUNDING_LABELS, type FundingType } from "@/lib/domain";
import { PERIODS, breakdown, check, fmtDays, fmtPct, median, pct, type BreakdownRow, type Metric } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo } from "@/lib/time";

export const metadata = { title: "Dashboard" };

type FamilyRow = { id: string; created_at: string; status: string; funding_type: FundingType; referral_source: string | null; suburb: string };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  await requireStaff();
  const { days: rawDays } = await searchParams;
  const days = (PERIODS as readonly number[]).includes(Number(rawDays)) ? Number(rawDays) : 90;
  const since = isoDaysAgo(days);
  const supabase = await createClient();

  const [{ data: families }, { data: history }, { data: matches }, { data: conversions }, { data: intros }, { data: clinicians }, { count: openCount }, { count: waitCount }] =
    await Promise.all([
      supabase.from("families").select("id, created_at, status, funding_type, referral_source, suburb").gte("created_at", since),
      supabase.from("status_history").select("entity_id, to_status, at").eq("entity_type", "family").gte("at", since),
      supabase.from("matches").select("state").gte("offered_at", since).in("state", ["accepted", "declined", "timeout"]),
      supabase.from("conversions").select("first_session_at, matches(family_id)").gte("confirmed_at", since),
      supabase.from("intro_calls").select("outcome").not("outcome", "is", null).gte("recorded_at", since),
      supabase.from("clinicians").select("status, pause_reason").in("status", ["active", "paused"]),
      supabase.from("families").select("id", { count: "exact", head: true }).not("status", "in", "(converted,lost,not_suitable,withdrawn)"),
      supabase.from("families").select("id", { count: "exact", head: true }).eq("status", "waitlist"),
    ]);

  const created = new Map((families ?? []).map((f: { id: string; created_at: string }) => [f.id, new Date(f.created_at)]));
  const firstAt = (status: string) => {
    const out = new Map<string, Date>();
    for (const h of (history ?? []) as { entity_id: string; to_status: string; at: string }[]) {
      if (h.to_status === status && !out.has(h.entity_id)) out.set(h.entity_id, new Date(h.at));
    }
    return out;
  };
  const toIntake: number[] = [];
  for (const [id, at] of firstAt("intake_booked")) if (created.has(id)) toIntake.push(businessDaysBetween(created.get(id)!, at));
  const toMatch: number[] = [];
  for (const [id, at] of firstAt("accepted")) if (created.has(id)) toMatch.push(businessDaysBetween(created.get(id)!, at));
  const toSession: number[] = [];
  for (const c of (conversions ?? []) as unknown as { first_session_at: string; matches: { family_id: string } }[]) {
    const start = created.get(c.matches.family_id);
    if (start) toSession.push(Math.round((Date.parse(c.first_session_at) - start.getTime()) / 86_400_000));
  }

  const ms = (matches ?? []) as { state: string }[];
  const accepted = ms.filter((m) => m.state === "accepted").length;
  const introRows = (intros ?? []) as { outcome: string }[];
  const cs = (clinicians ?? []) as { status: string; pause_reason: string | null }[];
  const credsCurrent = cs.filter((c) => !(c.status === "paused" && c.pause_reason === "credentials")).length;
  const converted = (conversions ?? []).length;

  const metrics: Metric[] = [
    { label: "Enquiry to sign-up call booked", value: fmtDays(median(toIntake), "business days"), target: "< 2 business days", ok: check(median(toIntake), (v) => v < 2) },
    { label: "Enquiry to clinician matched", value: fmtDays(median(toMatch), "business days"), target: "< 5 business days", ok: check(median(toMatch), (v) => v < 5) },
    { label: "Enquiry to first session", value: fmtDays(median(toSession), "days"), target: "< 14 days", ok: check(median(toSession), (v) => v < 14) },
    { label: "Referral acceptance", value: fmtPct(pct(accepted, ms.length)), target: "> 70%", ok: check(pct(accepted, ms.length), (v) => v > 70) },
    { label: "Intro call to first session", value: fmtPct(pct(converted, introRows.length)), target: "> 75%", ok: check(pct(converted, introRows.length), (v) => v > 75) },
    { label: "Open families on the waitlist", value: fmtPct(pct(waitCount ?? 0, openCount ?? 0)), target: "< 15%", ok: check(pct(waitCount ?? 0, openCount ?? 0), (v) => v < 15) },
    { label: "Clinicians with credentials current", value: fmtPct(pct(credsCurrent, cs.length)), target: "100%", ok: check(pct(credsCurrent, cs.length), (v) => v === 100) },
  ];

  const fams = (families ?? []) as FamilyRow[];

  return (
    <div className="flex min-h-full flex-col">
      <PageTabsHeader
        label="Dashboard"
        tabs={[{ href: "/dashboard", label: "Dashboard", active: true }]}
        actions={
          <nav aria-label="Period" className="flex rounded-md border border-neutral-200 p-0.5 text-sm">
            {PERIODS.map((d) => (
              <Link
                key={d}
                href={`/dashboard?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={cn("rounded px-2.5 py-1 tabular-nums", d === days ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900")}
              >
                {d}d
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="Key metrics" className="grid grid-cols-1 gap-x-10 gap-y-6 bg-neutral-100 px-4 py-5 sm:grid-cols-2 md:px-8 xl:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-1.5">
            <h2 className="text-sm text-neutral-800">{m.label}</h2>
            <p className={cn("text-2xl font-medium tracking-tight tabular-nums", m.ok === false && "text-red-800", m.ok === true && "text-emerald-800")}>
              {m.value}
              {m.ok !== null && <span className="sr-only">{m.ok ? " (on target)" : " (off target)"}</span>}
            </p>
            <p className="mt-auto text-xs text-neutral-500">Target {m.target}</p>
          </div>
        ))}
      </section>

      <p className="px-4 pt-4 text-sm text-neutral-500 md:px-8">Families who enquired in the last {days} days.</p>

      <div className="grid gap-x-10 gap-y-8 px-4 py-4 md:px-8 lg:grid-cols-3">
        <Breakdown title="By referral source" rows={breakdown(fams, (f) => f.referral_source ?? "Not given")} />
        <Breakdown title="By funding type" rows={breakdown(fams, (f) => FUNDING_LABELS[f.funding_type])} />
        <Breakdown title="By suburb" rows={breakdown(fams, (f) => f.suburb)} />
      </div>

      <p className="mt-auto px-4 pb-6 text-xs text-neutral-500 md:px-8">
        Sessions per clinician, 6-month retention and satisfaction scores arrive with payments and follow-up replies.
      </p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <section>
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <caption className="mb-2 text-left text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</caption>
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
            <th scope="col" className="py-2 pr-4 font-normal">
              <span className="sr-only">Group</span>
            </th>
            <th scope="col" className="w-24 py-2 pr-4 text-right font-normal">
              Enquiries
            </th>
            <th scope="col" className="w-24 py-2 text-right font-normal">
              Converted
            </th>
          </tr>
        </thead>
        <tbody className="text-neutral-600">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-neutral-500">
                No enquiries in this period.
              </td>
            </tr>
          ) : (
            rows.map(([k, v]) => (
              <tr key={k} className="border-b border-neutral-100">
                <td className="truncate py-2 pr-4 text-neutral-800" title={k}>
                  {k}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{v.total}</td>
                <td className="py-2 text-right tabular-nums">{fmtPct(pct(v.converted, v.total))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
