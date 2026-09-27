import Link from "next/link";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { FUNDING_LABELS, PROFESSION_LABELS, type FundingType, type Profession } from "@/lib/domain";
import { runMatching } from "@/lib/matching";
import { loadMatchClinicians, toMatchChild, toMatchFamily } from "@/lib/server/matching-data";
import { createClient } from "@/lib/supabase/server";
import { relativeHours, hoursSince, todayInAustralia } from "@/lib/time";
import type { ChildRow, FamilyRow } from "@/lib/types";

export const metadata = { title: "Waitlist" };

export default async function WaitlistPage() {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: families }, clinicians] = await Promise.all([
    supabase.from("families").select("*, children(*)").eq("status", "waitlist").order("status_changed_at"),
    loadMatchClinicians(supabase),
  ]);
  const today = todayInAustralia();
  const rows = ((families ?? []) as (FamilyRow & { children: ChildRow[] })[]).map((f) => {
    const child = f.children[0];
    const result = child ? runMatching(toMatchChild(child), toMatchFamily(f), clinicians, { today, suburb: f.suburb }) : null;
    return { f, child, available: result?.shortlist.length ?? 0 };
  });

  // Recruitment targeting: tally what's missing across the waitlist.
  const gaps = { area: new Map<string, number>(), funding: new Map<string, number>(), profession: new Map<string, number>(), blocker: new Map<string, number>() };
  for (const { f } of rows) {
    for (const code of f.waitlist_codes) {
      const [kind, value] = code.split(":");
      const map = gaps[kind as keyof typeof gaps];
      if (map) map.set(value, (map.get(value) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Families nobody could take yet. Matching re-runs every time you open this page. Anyone with a green badge can be matched now."
      />
      {rows.length === 0 ? (
        <EmptyState>No families on the waitlist.</EmptyState>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {rows
              .sort((a, b) => b.available - a.available)
              .map(({ f, child, available }) => (
                <li key={f.id}>
                  <Link href={`/families/${f.id}`} className="flex flex-col gap-1 p-3 text-sm hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-medium">{child?.first_name}</span> · {f.suburb} {f.postcode} · {FUNDING_LABELS[f.funding_type]}
                      <span className="block text-xs text-stone-500">{f.waitlist_reason}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {available > 0 ? <Badge tone="green">{available} can match now</Badge> : <Badge tone="amber">still no match</Badge>}
                      <span className="text-xs text-stone-500">waiting {relativeHours(hoursSince(f.status_changed_at))}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardTitle>Where we&apos;re short: recruitment targets</CardTitle>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <h3 className="mb-1 font-medium">Postcodes</h3>
              <ul>{top(gaps.area).map(([k, n]) => <li key={k}>{k} <span className="text-stone-500">× {n}</span></li>)}</ul>
            </div>
            <div>
              <h3 className="mb-1 font-medium">Funding</h3>
              <ul>{top(gaps.funding).map(([k, n]) => <li key={k}>{FUNDING_LABELS[k as FundingType] ?? k} <span className="text-stone-500">× {n}</span></li>)}</ul>
            </div>
            <div>
              <h3 className="mb-1 font-medium">Profession</h3>
              <ul>{top(gaps.profession).map(([k, n]) => <li key={k}>{PROFESSION_LABELS[k as Profession] ?? "Either"} <span className="text-stone-500">× {n}</span></li>)}</ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
