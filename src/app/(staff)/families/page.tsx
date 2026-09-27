import Link from "next/link";
import { FamilyStatusBadge } from "@/components/display";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { EXIT_STATUSES, FAMILY_STATUS_LABELS, FAMILY_STATUSES, FUNDING_LABELS, FUNNEL_STATUSES, type FamilyStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { relativeHours } from "@/lib/time";
import type { PipelineRow } from "@/lib/types";

export const metadata = { title: "Families" };

const BOARD: FamilyStatus[] = FUNNEL_STATUSES.filter((s) => s !== "converted");

export default async function FamiliesPage({ searchParams }: PageProps<"/families">) {
  await requireStaff();
  const params = await searchParams;
  const status = typeof params.status === "string" && (FAMILY_STATUSES as readonly string[]).includes(params.status) ? (params.status as FamilyStatus) : null;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const supabase = await createClient();
  let query = supabase.from("family_pipeline").select("*").order("status_changed_at", { ascending: true }).limit(500);
  if (status) query = query.eq("status", status);
  else if (!q) query = query.in("status", BOARD);
  if (q) {
    // Quote values and strip characters with meaning in PostgREST filters.
    const safe = q.replace(/[%,()"\\*]/g, " ").trim();
    const conditions = [`parent_name.ilike."%${safe}%"`, `suburb.ilike."%${safe}%"`, `child_names.ilike."%${safe}%"`];
    if (/^\d{4}$/.test(safe)) conditions.push(`postcode.eq.${safe}`);
    query = query.or(conditions.join(","));
  }
  const { data } = await query;
  const families = (data ?? []) as PipelineRow[];

  return (
    <div>
      <PageHeader
        title="Families"
        description="Everyone from enquiry to first session. Red means they've waited longer than the target for that step."
        actions={<LinkButton href="/enquire">New enquiry</LinkButton>}
      />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">
          Search families
        </label>
        <Input name="q" id="q" defaultValue={q} placeholder="Search by parent, child, suburb or postcode" className="sm:max-w-sm" />
        {status && <input type="hidden" name="status" value={status} />}
        <button className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-sm">Search</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterChip href="/families" active={!status}>Open pipeline</FilterChip>
        {["converted", ...EXIT_STATUSES].map((s) => (
          <FilterChip key={s} href={`/families?status=${s}`} active={status === s}>
            {FAMILY_STATUS_LABELS[s as FamilyStatus]}
          </FilterChip>
        ))}
      </div>

      {status || q ? (
        <FamilyList families={families} />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4">
          <div className="flex gap-3">
            {BOARD.map((s) => {
              const col = families.filter((f) => f.status === s);
              return (
                <section key={s} aria-labelledby={`col-${s}`} className="w-64 shrink-0 rounded-xl bg-stone-100 p-2">
                  <h2 id={`col-${s}`} className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-stone-700">
                    <Link href={`/families?status=${s}`} className="hover:underline">
                      {FAMILY_STATUS_LABELS[s]}
                    </Link>
                    <span className="text-stone-500">{col.length}</span>
                  </h2>
                  <ul className="space-y-2">
                    {col.map((f) => (
                      <li key={f.id}>
                        <FamilyCard f={f} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-full border px-3 py-1", active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-stone-300 bg-white text-stone-700")}
    >
      {children}
    </Link>
  );
}

function FamilyCard({ f }: { f: PipelineRow }) {
  return (
    <Link
      href={`/families/${f.id}`}
      className={cn("block rounded-lg border bg-white p-2.5 text-sm shadow-sm hover:border-brand-500", f.is_stale ? "border-red-300" : "border-stone-200")}
    >
      <span className="block font-medium text-stone-900">{f.child_names ?? "–"}</span>
      <span className="block text-stone-600">
        {f.parent_name} · {f.suburb}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-1">
        <Badge>{FUNDING_LABELS[f.funding_type]}</Badge>
        {f.complex_case && <Badge tone="violet">Complex</Badge>}
        {!f.geocoded && <Badge tone="amber">Not on map</Badge>}
        <span className={cn("ml-auto text-xs", f.is_stale ? "font-semibold text-red-700" : "text-stone-500")}>{relativeHours(f.hours_in_status)}</span>
      </span>
    </Link>
  );
}

function FamilyList({ families }: { families: PipelineRow[] }) {
  if (!families.length) return <EmptyState>No families found.</EmptyState>;
  return (
    <Card className="p-0 sm:p-0">
      <ul className="divide-y divide-stone-100">
        {families.map((f) => (
          <li key={f.id}>
            <Link href={`/families/${f.id}`} className="flex flex-col gap-1 p-3 text-sm hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="font-medium">{f.child_names}</span> · {f.parent_name} · {f.suburb}
                {f.status_reason && <span className="block text-xs text-stone-500">{f.status_reason}</span>}
              </span>
              <span className="flex items-center gap-2">
                <FamilyStatusBadge status={f.status} />
                <span className={cn("text-xs", f.is_stale ? "font-semibold text-red-700" : "text-stone-500")}>{relativeHours(f.hours_in_status)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
