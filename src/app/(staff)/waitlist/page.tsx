import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { childFullName } from "@/lib/client-summary";
import { FUNDING_LABELS } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { relativeHours, hoursSince } from "@/lib/time";
import type { ChildRow, FamilyRow } from "@/lib/types";

export const metadata = { title: "Waitlist" };

export default async function WaitlistPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data: families } = await supabase.from("families").select("*, children(*)").eq("status", "waitlist").order("status_changed_at");
  const rows = (families ?? []) as (FamilyRow & { children: ChildRow[] })[];

  return (
    <div className="space-y-6">
      <PageHeader title="Waitlist" description="Families waiting for a clinician, longest wait first. Open one to allocate a clinician." />
      {rows.length === 0 ? (
        <EmptyState>No families on the waitlist.</EmptyState>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {rows.map((f) => (
              <li key={f.id}>
                <Link href={`/families/${f.id}`} className="flex flex-col gap-1 p-3 text-sm hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{f.children.map(childFullName).join(" & ") || f.parent_name}</span> · {f.suburb} {f.postcode}
                    {f.state && `, ${f.state}`} · {FUNDING_LABELS[f.funding_type]}
                    {f.waitlist_reason && <span className="block text-xs text-stone-500">{f.waitlist_reason}</span>}
                  </span>
                  <span className="text-xs text-stone-500">waiting {relativeHours(hoursSince(f.status_changed_at))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
