import Link from "next/link";
import { ClinicianStatusBadge, DateOnly, credentialLabel } from "@/components/display";
import { Alert, Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireClinician } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, todayInAustralia } from "@/lib/time";
import type { ClinicianRow, CredentialRow, OfferSummary } from "@/lib/types";
import { OfferCard } from "./offer-card";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const viewer = await requireClinician();
  const supabase = await createClient();
  const today = todayInAustralia();
  const [{ data: me }, { data: offers }, { data: creds }, { count: active }] = await Promise.all([
    supabase.from("clinicians").select("*").eq("id", viewer.clinicianId).single<ClinicianRow>(),
    supabase.rpc("get_my_offers"),
    supabase.from("credentials").select("*").eq("clinician_id", viewer.clinicianId).in("status", ["verified", "expired", "rejected"]),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("clinician_id", viewer.clinicianId).eq("state", "accepted"),
  ]);
  const open = ((offers ?? []) as OfferSummary[]).filter((o) => o.state === "offered");
  const expiring = ((creds ?? []) as CredentialRow[]).filter(
    (c) => c.status === "expired" || c.status === "rejected" || (c.expires_at && daysUntil(c.expires_at, today) <= 60),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hi ${viewer.fullName.split(" ")[0]}`}
        description={me && <ClinicianStatusBadge status={me.status} pauseReason={me.pause_reason} />}
      />
      {me?.status === "paused" && (
        <Alert>
          New referrals are paused{me.pause_reason === "credentials" ? " until your documents are up to date" : ""}. Families you&apos;re already seeing stay with you.
        </Alert>
      )}

      <Card>
        <CardTitle>Referrals waiting for you ({open.length})</CardTitle>
        {open.length === 0 ? (
          <EmptyState>No new referrals right now. We&apos;ll text you when one comes in.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {open.map((o) => (
              <li key={o.match_id}>
                <OfferCard offer={o} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Capacity</CardTitle>
          <p className="text-sm">
            {me?.snoozed_until ? (
              <>Not taking new referrals until <DateOnly date={me.snoozed_until} />.</>
            ) : (
              <>
                Taking <strong>{me?.capacity_new ?? 0}</strong> more new {me?.capacity_new === 1 ? "family" : "families"}.
              </>
            )}{" "}
            You&apos;re seeing {active ?? 0} {active === 1 ? "family" : "families"} we referred.
          </p>
          <LinkButton href="/portal/profile" size="sm" className="mt-3">
            Update capacity
          </LinkButton>
        </Card>

        <Card>
          <CardTitle>Documents</CardTitle>
          {expiring.length === 0 ? (
            <p className="text-sm text-stone-600">Everything is up to date.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {expiring.map((c) => (
                <li key={c.id} className={c.status !== "verified" ? "text-red-700" : ""}>
                  {credentialLabel(c.type)}:{" "}
                  {c.status === "rejected" ? "needs a new copy" : c.status === "expired" ? "expired" : <>expires <DateOnly date={c.expires_at} /></>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/portal/documents" className="mt-3 inline-block text-sm text-brand-700 underline">
            Upload a document
          </Link>
        </Card>
      </div>
    </div>
  );
}
