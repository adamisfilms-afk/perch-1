import type { ReactNode } from "react";
import { FirstSessionForm, IntroOutcomeForm } from "@/components/referral-forms";
import { CONCERN_LABELS, FUNDING_LABELS, SERVICE_LABELS, TIME_BLOCK_LABELS, type Concern } from "@/lib/domain";
import { loadReferral, resolveReferralLink, type ReferralView } from "@/lib/server/clinician-link";
import { formatDate, formatDateTime } from "@/lib/time";
import { LinkExpired } from "../../link-expired";
import { confirmFirstSession, recordIntro, respond } from "./actions";
import { RespondForm } from "./respond-form";

export const metadata = { title: "Referral", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const heading = "mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400";

/**
 * One referral, for the clinician it was offered to (no login). Before they accept it shows only a de-identified
 * summary; after, it's where they record the intro call and the first session. Names and contact details are
 * never shown here: they're emailed once the clinician accepts.
 */
export default async function ReferralPage({ params }: PageProps<"/referral/[token]">) {
  const { token } = await params;
  const link = await resolveReferralLink(token);
  const view = link ? await loadReferral(link.matchId) : null;
  if (!view) return <LinkExpired />;
  const s = view.summary;
  const title = `${s.childAge !== null ? `${s.childAge}-year-old` : "Child"} in ${s.suburb}`;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-neutral-500">Referral for {view.clinicianFirstName}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
      </div>

      <Summary view={view} />

      {view.open ? (
        <section className="space-y-3">
          <p className="text-sm text-neutral-600">
            Please reply by {formatDateTime(view.offerExpiresAt)}. Declining is completely fine and has no effect on future referrals. We&apos;ll email you the
            family&apos;s details once you accept.
          </p>
          <RespondForm action={respond.bind(null, token)} />
        </section>
      ) : view.state === "accepted" ? (
        <Accepted view={view} token={token} />
      ) : (
        <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          {view.state === "declined"
            ? "You declined this referral. Thanks for letting us know."
            : view.state === "offered" || view.state === "timeout"
              ? "This referral has closed. Thanks anyway."
              : "This referral is no longer open. Thanks for considering it."}
        </p>
      )}

      <p className="text-xs text-neutral-500">
        Your profile, hours and documents are on{" "}
        <a href={view.clinicianPageUrl} className="underline underline-offset-4">
          your Perch page
        </a>
        .
      </p>
    </div>
  );
}

function Summary({ view }: { view: ReferralView }) {
  const s = view.summary;
  const rows: [string, ReactNode][] = [
    ["Child", s.childAge !== null ? `${s.childAge} years old` : null],
    ["Area", s.suburb],
    ["Service", SERVICE_LABELS[s.serviceType]],
    ["Concerns", [s.concerns.map((c) => CONCERN_LABELS[c as Concern] ?? c).join(", "), s.concernOther].filter(Boolean).join(": ")],
    ["Funding", FUNDING_LABELS[s.fundingType]],
    ["Preferred times", s.preferredTimes.map((t) => TIME_BLOCK_LABELS[t]).join(", ") || "Flexible"],
    ["Language", s.language],
    ["Telehealth", s.telehealthOk ? "Family is open to telehealth" : null],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-neutral-900">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Accepted({ view, token }: { view: ReferralView; token: string }) {
  if (view.firstSessionAt) {
    return (
      <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        First session confirmed for {formatDate(view.firstSessionAt)}. Thanks! From here the family is managed in your Halaxy.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        You accepted this referral. The family&apos;s details are in the email we sent you.
        {view.introAt ? ` Their intro call is booked for ${formatDateTime(view.introAt)}.` : " We'll email you when they book their intro call."}
      </p>
      {!view.introOutcome && (
        <section>
          <h2 className={heading}>After the intro call</h2>
          <IntroOutcomeForm action={recordIntro.bind(null, token)} />
        </section>
      )}
      <section>
        <h2 className={heading}>First session</h2>
        <FirstSessionForm action={confirmFirstSession.bind(null, token)} />
      </section>
    </div>
  );
}
