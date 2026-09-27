import { Card, CardTitle, PageHeader, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { businessDaysBetween } from "@/lib/business-days";
import { FUNDING_LABELS, type FundingType } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo } from "@/lib/time";

export const metadata = { title: "Metrics" };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

export default async function MetricsPage({ searchParams }: PageProps<"/metrics">) {
  await requireStaff();
  const { days: rawDays } = await searchParams;
  const days = [30, 90, 180, 365].includes(Number(rawDays)) ? Number(rawDays) : 90;
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

  const metrics: { label: string; value: string; target: string; ok: boolean | null }[] = [
    { label: "Enquiry to intake call booked (median)", value: fmtDays(median(toIntake), "business days"), target: "< 2 business days", ok: check(median(toIntake), (v) => v < 2) },
    { label: "Enquiry to accepted match (median)", value: fmtDays(median(toMatch), "business days"), target: "< 5 business days", ok: check(median(toMatch), (v) => v < 5) },
    { label: "Enquiry to first session (median)", value: fmtDays(median(toSession), "days"), target: "< 14 days", ok: check(median(toSession), (v) => v < 14) },
    { label: "Referral acceptance rate", value: fmtPct(pct(accepted, ms.length)), target: "> 70%", ok: check(pct(accepted, ms.length), (v) => v > 70) },
    {
      label: "Intro call to conversion",
      value: fmtPct(pct((conversions ?? []).length, introRows.length)),
      target: "> 75%",
      ok: check(pct((conversions ?? []).length, introRows.length), (v) => v > 75),
    },
    { label: "Share of open families on the waitlist", value: fmtPct(pct(waitCount ?? 0, openCount ?? 0)), target: "< 15%", ok: check(pct(waitCount ?? 0, openCount ?? 0), (v) => v < 15) },
    { label: "Clinicians with all credentials current", value: fmtPct(pct(credsCurrent, cs.length)), target: "100%", ok: check(pct(credsCurrent, cs.length), (v) => v === 100) },
  ];

  const fams = (families ?? []) as { status: string; funding_type: FundingType; referral_source: string | null; suburb: string }[];
  const breakdown = (key: (f: (typeof fams)[number]) => string) => {
    const m = new Map<string, { total: number; converted: number }>();
    for (const f of fams) {
      const k = key(f);
      const row = m.get(k) ?? { total: 0, converted: 0 };
      row.total += 1;
      if (f.status === "converted") row.converted += 1;
      m.set(k, row);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description={`Families who enquired in the last ${days} days.`}
        actions={[30, 90, 180, 365].map((d) => (
          <a key={d} href={`/metrics?days=${d}`} aria-current={d === days ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-sm", d === days ? "border-brand-600 bg-brand-50" : "border-stone-300 bg-white")}>
            {d}d
          </a>
        ))}
      />
      <Card className="p-0 sm:p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs text-stone-500">
            <tr>
              <th className="p-3 font-medium">Metric</th>
              <th className="p-3 font-medium">Now</th>
              <th className="p-3 font-medium">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {metrics.map((m) => (
              <tr key={m.label}>
                <td className="p-3">{m.label}</td>
                <td className={cn("p-3 font-semibold tabular-nums", m.ok === false && "text-red-700", m.ok === true && "text-emerald-700")}>
                  {m.value}
                  {m.ok !== null && <span className="sr-only">{m.ok ? " (on target)" : " (off target)"}</span>}
                </td>
                <td className="p-3 text-stone-600">{m.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-stone-100 p-3 text-xs text-stone-500">
          Sessions per clinician, 6-month retention and satisfaction scores arrive with fee statements and follow-up replies (v1.1).
        </p>
      </Card>
      <div className="grid gap-6 md:grid-cols-3">
        <Breakdown title="By referral source" rows={breakdown((f) => f.referral_source ?? "Not given")} />
        <Breakdown title="By funding type" rows={breakdown((f) => FUNDING_LABELS[f.funding_type])} />
        <Breakdown title="By suburb" rows={breakdown((f) => f.suburb)} />
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, { total: number; converted: number }][] }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <table className="w-full text-sm">
        <thead className="text-xs text-stone-500">
          <tr>
            <th className="text-left font-medium" />
            <th className="text-right font-medium">Enquiries</th>
            <th className="text-right font-medium">Converted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1">{k}</td>
              <td className="py-1 text-right tabular-nums">{v.total}</td>
              <td className="py-1 text-right tabular-nums">{fmtPct(pct(v.converted, v.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function fmtDays(v: number | null, unit: string) {
  return v === null ? "–" : `${Math.round(v * 10) / 10} ${unit}`;
}
function fmtPct(v: number | null) {
  return v === null ? "–" : `${v}%`;
}
function check(v: number | null, ok: (v: number) => boolean): boolean | null {
  return v === null ? null : ok(v);
}
