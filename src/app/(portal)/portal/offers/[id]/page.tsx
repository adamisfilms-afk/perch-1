import Link from "next/link";
import { notFound } from "next/navigation";
import { When } from "@/components/display";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireClinician } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OfferSummary } from "@/lib/types";
import { respondToOffer } from "../../actions";
import { OfferSummaryDetails } from "../../offer-card";
import { RespondForm } from "./respond-form";

export const metadata = { title: "Referral" };

export default async function OfferPage({ params }: PageProps<"/portal/offers/[id]">) {
  await requireClinician();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_offers");
  const offer = ((data ?? []) as OfferSummary[]).find((o) => o.match_id === id);
  if (!offer) notFound();
  await supabase.rpc("log_access", { p_entity_type: "matches", p_entity_id: id, p_action: "view" });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={`${offer.child_age_years}-year-old in ${offer.suburb}`} actions={<Link href="/portal/offers" className="text-sm text-brand-700 underline">← Referrals</Link>} />
      <Card className="space-y-4">
        <OfferSummaryDetails offer={offer} />
        {offer.state === "offered" ? (
          <>
            <p className="text-sm text-stone-600">
              Please reply by <When at={offer.offer_expires_at} />. Names and contact details are shared once you accept.
            </p>
            <RespondForm action={respondToOffer.bind(null, offer.match_id)} />
          </>
        ) : (
          <Alert tone="blue">This referral is no longer open.</Alert>
        )}
      </Card>
    </div>
  );
}
