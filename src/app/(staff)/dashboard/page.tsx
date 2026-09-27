import Link from "next/link";
import { ClinicianStatusBadge, DateOnly, FamilyStatusBadge, When, credentialLabel } from "@/components/display";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { FAMILY_STATUS_LABELS, FUNNEL_STATUSES, type FamilyStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, relativeHours, todayInAustralia } from "@/lib/time";
import type { ClinicianRow, CredentialRow, PipelineRow } from "@/lib/types";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const viewer = await requireStaff();
  const supabase = await createClient();
  const today = todayInAustralia();
  const in30 = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);

  const [pipeline, offers, expiring, pendingDocs, paused] = await Promise.all([
    supabase.from("family_pipeline").select("*").not("status", "in", "(converted,lost,not_suitable,withdrawn)"),
    supabase
      .from("matches")
      .select("id, family_id, offered_at, offer_expires_at, clinicians(name), children(first_name)")
      .eq("state", "offered")
      .order("offer_expires_at"),
    supabase
      .from("credentials")
      .select("id, type, expires_at, clinician_id, clinicians!inner(name, status)")
      .eq("status", "verified")
      .lte("expires_at", in30)
      .neq("clinicians.status", "offboarded")
      .order("expires_at"),
    supabase.from("credentials").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("clinicians").select("id, name, pause_reason, status, status_changed_at").eq("status", "paused"),
  ]);

  const families = (pipeline.data ?? []) as PipelineRow[];
  const byStatus = new Map<FamilyStatus, PipelineRow[]>();
  for (const f of families) byStatus.set(f.status, [...(byStatus.get(f.status) ?? []), f]);
  const stale = families.filter((f) => f.is_stale).sort((a, b) => b.hours_in_status - a.hours_in_status);
  const waitlist = byStatus.get("waitlist") ?? [];
  const waitlistReasons = new Map<string, number>();
  for (const f of waitlist) {
    const key = f.waitlist_reason ?? "No reason recorded";
    waitlistReasons.set(key, (waitlistReasons.get(key) ?? 0) + 1);
  }
  const ungeocoded = families.filter((f) => !f.geocoded);

  type OfferRow = { id: string; family_id: string; offered_at: string; offer_expires_at: string; clinicians: { name: string }; children: { first_name: string } };
  type ExpiringRow = Pick<CredentialRow, "id" | "type" | "expires_at" | "clinician_id"> & { clinicians: { name: string } };

  return (
    <div className="space-y-6">
      <PageHeader title={`Good ${greeting()}, ${viewer.fullName.split(" ")[0]}`} description="What needs attention today." />

      <Card>
        <CardTitle action={<Link href="/families" className="text-sm text-brand-700 underline">Open the board</Link>}>Family funnel</CardTitle>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {FUNNEL_STATUSES.filter((s) => s !== "converted").map((s) => {
            const rows = byStatus.get(s) ?? [];
            const staleCount = rows.filter((r) => r.is_stale).length;
            return (
              <li key={s}>
                <Link href={`/families?status=${s}`} className="block rounded-lg border border-stone-200 p-2 hover:border-brand-500">
                  <span className="block text-xs text-stone-500">{FAMILY_STATUS_LABELS[s]}</span>
                  <span className="text-xl font-semibold">{rows.length}</span>
                  {staleCount > 0 && <span className="ml-1 text-xs font-medium text-red-700">{staleCount} stale</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Stale families ({stale.length})</CardTitle>
          {stale.length === 0 ? (
            <EmptyState>Nothing is waiting too long. 🎉</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100">
              {stale.slice(0, 12).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/families/${f.id}`} className="font-medium text-stone-900 hover:underline">
                    {f.parent_name} <span className="font-normal text-stone-500">· {f.suburb}</span>
                  </Link>
                  <span className="flex items-center gap-2">
                    <FamilyStatusBadge status={f.status} />
                    <span className="text-red-700">{relativeHours(f.hours_in_status)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Offers waiting on a clinician ({offers.data?.length ?? 0})</CardTitle>
          {!offers.data?.length ? (
            <EmptyState>No offers out right now.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100">
              {(offers.data as unknown as OfferRow[]).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/families/${o.family_id}`} className="hover:underline">
                    {o.children.first_name} → <span className="font-medium">{o.clinicians.name}</span>
                  </Link>
                  <span className="text-right text-xs text-stone-500">
                    closes <When at={o.offer_expires_at} uk={viewer.showUkTime} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/waitlist" className="text-sm text-brand-700 underline">Waitlist</Link>}>
            Waitlist ({waitlist.length} of {families.length} open families)
          </CardTitle>
          {waitlist.length === 0 ? (
            <EmptyState>No families waiting.</EmptyState>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...waitlistReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                <li key={reason} className="flex justify-between gap-3">
                  <span>{reason}</span>
                  <Badge tone="amber">{n}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/verification" className="text-sm text-brand-700 underline">Verification queue</Link>}>
            Credentials
          </CardTitle>
          <p className="mb-3 text-sm">
            <Badge tone={pendingDocs.count ? "blue" : "green"}>{pendingDocs.count ?? 0}</Badge> documents waiting to be verified
          </p>
          {!expiring.data?.length ? (
            <EmptyState>Nothing expires in the next 30 days.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100">
              {(expiring.data as unknown as ExpiringRow[]).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/clinicians/${c.clinician_id}`} className="hover:underline">
                    <span className="font-medium">{c.clinicians.name}</span> · {credentialLabel(c.type)}
                  </Link>
                  <span className={daysUntil(c.expires_at!, today) <= 7 ? "font-medium text-red-700" : "text-stone-600"}>
                    <DateOnly date={c.expires_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Paused clinicians ({paused.data?.length ?? 0})</CardTitle>
          {!paused.data?.length ? (
            <EmptyState>Everyone is active.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100">
              {(paused.data as Pick<ClinicianRow, "id" | "name" | "pause_reason" | "status" | "status_changed_at">[]).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/clinicians/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <ClinicianStatusBadge status={c.status} pauseReason={c.pause_reason} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {ungeocoded.length > 0 && (
          <Card>
            <CardTitle>Suburbs not on the map ({ungeocoded.length})</CardTitle>
            <p className="mb-2 text-sm text-stone-600">These families can only match on suburb lists until their location is fixed.</p>
            <ul className="space-y-1 text-sm">
              {ungeocoded.map((f) => (
                <li key={f.id}>
                  <Link href={`/families/${f.id}`} className="hover:underline">
                    {f.parent_name} · {f.suburb} {f.postcode}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
