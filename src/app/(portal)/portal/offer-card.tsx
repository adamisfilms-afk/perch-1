import Link from "next/link";
import { When } from "@/components/display";
import { Badge } from "@/components/ui";
import { CONCERN_LABELS, FUNDING_LABELS, SERVICE_LABELS, TIME_BLOCK_LABELS, type Concern } from "@/lib/domain";
import type { OfferSummary } from "@/lib/types";

/** What a clinician sees before accepting: never names, contact details or address. */
export function OfferSummaryDetails({ offer }: { offer: OfferSummary }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-stone-500">Child</dt>
      <dd>{offer.child_age_years} years old</dd>
      <dt className="text-stone-500">Area</dt>
      <dd>
        {offer.suburb}
        {offer.distance_km !== null && ` (about ${offer.distance_km} km from you)`}
      </dd>
      <dt className="text-stone-500">Service</dt>
      <dd>{SERVICE_LABELS[offer.service_type]}</dd>
      <dt className="text-stone-500">Concerns</dt>
      <dd>
        {offer.concerns.map((c) => CONCERN_LABELS[c as Concern] ?? c).join(", ")}
        {offer.concern_other && ` (${offer.concern_other})`}
      </dd>
      <dt className="text-stone-500">Funding</dt>
      <dd>{FUNDING_LABELS[offer.funding_type]}</dd>
      <dt className="text-stone-500">Times</dt>
      <dd>{offer.preferred_times.map((t) => TIME_BLOCK_LABELS[t]).join(", ") || "Flexible"}</dd>
      {offer.language && (
        <>
          <dt className="text-stone-500">Language</dt>
          <dd>{offer.language}</dd>
        </>
      )}
      {offer.telehealth_ok && (
        <>
          <dt className="text-stone-500">Telehealth</dt>
          <dd>Family is open to telehealth</dd>
        </>
      )}
    </dl>
  );
}

export function OfferCard({ offer }: { offer: OfferSummary }) {
  return (
    <Link href={`/portal/offers/${offer.match_id}`} className="block rounded-lg border border-amber-200 bg-amber-50 p-3 hover:border-amber-400">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {offer.child_age_years}-year-old in {offer.suburb}
        </span>
        <Badge tone="amber">
          <span className="mr-1">Reply by</span> <When at={offer.offer_expires_at} />
        </Badge>
      </span>
      <span className="mt-1 block text-sm text-stone-700">
        {SERVICE_LABELS[offer.service_type]} · {offer.concerns.map((c) => CONCERN_LABELS[c as Concern] ?? c).join(", ")} · {FUNDING_LABELS[offer.funding_type]}
      </span>
    </Link>
  );
}
