import { EmptyState, PageHeader } from "@/components/ui";
import { MatchStateBadge, When } from "@/components/display";
import { requireClinician } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OfferSummary } from "@/lib/types";
import { OfferCard } from "../offer-card";

export const metadata = { title: "Referrals" };

export default async function OffersPage() {
  await requireClinician();
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_offers");
  const offers = (data ?? []) as OfferSummary[];
  const open = offers.filter((o) => o.state === "offered");
  const past = offers.filter((o) => o.state !== "offered");
  return (
    <div className="space-y-6">
      <PageHeader title="Referrals" description="You choose which referrals to accept. Declining never counts against you." />
      {open.length === 0 ? <EmptyState>No referrals waiting.</EmptyState> : (
        <ul className="space-y-3">{open.map((o) => <li key={o.match_id}><OfferCard offer={o} /></li>)}</ul>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Past referrals</h2>
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white text-sm">
            {past.map((o) => (
              <li key={o.match_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>{o.child_age_years}-year-old in {o.suburb}</span>
                <span className="flex items-center gap-2 text-xs text-stone-500">
                  <MatchStateBadge state={o.state} /> <When at={o.responded_at ?? o.offered_at} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
