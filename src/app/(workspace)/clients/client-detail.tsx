// The tabs of a client's record (Info, Bookings, History), shared by the summary modal and the full record page.
import { AllocateClinician } from "@/components/workspace/allocate-clinician";
import { CopyLink } from "@/components/workspace/copy-link";
import { BookingList, Empty, Facts, HistoryList, Section, type Booking } from "@/components/workspace/detail-parts";
import { CLIENT_STATUS_LABELS, allocationBlockedReason, childFullName } from "@/lib/client-summary";
import {
  CONCERN_LABELS,
  FUNDING_LABELS,
  INTEREST_LABELS,
  MATCH_STATE_LABELS,
  SERVICE_LABELS,
  TIME_BLOCK_LABELS,
  type Concern,
  type FamilyStatus,
  type TimeBlock,
} from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import { ageFrom, formatDate, formatDateTime } from "@/lib/time";
import type { ClientDetail } from "./actions";

export const CLIENT_TABS = [
  { id: "info", label: "Info" },
  { id: "bookings", label: "Bookings" },
  { id: "history", label: "History" },
];

const CONSENT_LABELS: Record<string, string> = {
  privacy_collection: "Privacy collection notice",
  contact: "Contact about services",
  share_with_clinician: "Share details with the matched clinician",
};

const bookingTime = (b: Booking) => (b.dateOnly ? formatDate(b.at) : formatDateTime(b.at));

/** Everything they registered with, plus who their clinician is. */
export function ClientInfo({ detail, onChanged }: { detail: ClientDetail; onChanged?: () => void }) {
  const { family, children, consents, matches } = detail;
  const allocated = matches.find((m) => m.state === "accepted");
  return (
    <div className="space-y-8">
      <Section title="Clinician">
        <AllocateClinician
          familyId={family.id}
          current={allocated ? { id: allocated.clinician_id, name: allocated.clinician ?? "Clinician" } : null}
          blockedReason={allocationBlockedReason(family.status)}
          onAllocated={onChanged}
        />
      </Section>

      <Section title="Contact">
        <Facts
          items={[
            ["Parent or carer", family.parent_name],
            ["Email", <a key="e" href={`mailto:${family.email}`} className="underline underline-offset-4">{family.email}</a>],
            ["Mobile", <a key="m" href={`tel:${family.mobile}`} className="underline underline-offset-4">{formatAuMobile(family.mobile)}</a>],
            ["Location", `${family.suburb} ${family.postcode}${family.state ? `, ${family.state}` : ""}`],
            ["Funding", FUNDING_LABELS[family.funding_type]],
            ["Plan manager", family.plan_manager],
            ["Heard about us", family.referral_source],
            ["Signed up", formatDateTime(family.created_at)],
            ["Coordinator", family.assigned_name],
            ["Complex case", family.complex_case ? "Yes: a clinical lead allocates the clinician" : "No"],
          ]}
        />
      </Section>

      <Section title="Status">
        <Facts
          items={[
            ["Current step", CLIENT_STATUS_LABELS[family.status]],
            ["Since", formatDateTime(family.status_changed_at)],
            ["Reason", family.status_reason],
            ["Waitlist reason", family.waitlist_reason],
          ]}
        />
      </Section>

      {children.map((c) => (
        <Section key={c.id} title={`Child: ${childFullName(c)}`}>
          <Facts
            items={[
              ["Age", ageFrom(c.dob, c.age_years)?.toString() ?? null],
              ["Date of birth", c.dob ? formatDate(c.dob) : null],
              ["Service", SERVICE_LABELS[c.service_type]],
              ["Concerns", [...c.concerns.map((x) => CONCERN_LABELS[x as Concern] ?? x), c.concern_other].filter(Boolean).join(", ") || null],
              ["Preferred times", c.preferred_times.map((t) => TIME_BLOCK_LABELS[t as TimeBlock]).join(", ") || null],
              ["Language at home", c.language],
              ["Clinician gender", c.gender_preference ? `Prefers ${c.gender_preference}` : null],
              ["Telehealth", c.telehealth_ok ? "Open to telehealth" : "In person"],
              ["Special interests", c.interests_needed.map((i) => INTEREST_LABELS[i] ?? i).join(", ") || null],
              ["Intake notes", c.notes_intake],
            ]}
          />
        </Section>
      ))}

      <Section title="Consent">
        {!consents.length ? (
          <Empty>No consent recorded.</Empty>
        ) : (
          <Facts
            items={consents.map((c) => [
              CONSENT_LABELS[c.type] ?? c.type,
              c.withdrawn_at ? <span className="text-red-800">Withdrawn {formatDate(c.withdrawn_at)}</span> : `Given ${formatDate(c.granted_at)} (v${c.version})`,
            ])}
          />
        )}
      </Section>
    </div>
  );
}

/** Sign-up calls, intro calls and first sessions: upcoming first, then past. */
export function ClientBookings({ detail }: { detail: ClientDetail }) {
  const { signupCall, introCall } = detail.links;
  return (
    <div className="space-y-8">
      {(signupCall || introCall) && (
        <Section title="Booking links">
          <div className="space-y-2">
            {signupCall && <CopyLink label="Sign-up call booking page" url={signupCall} />}
            {introCall && <CopyLink label="Intro call booking page" url={introCall} />}
          </div>
          <p className="mt-2 text-xs text-neutral-500">The family was emailed this link. Send it again by text if they need it.</p>
        </Section>
      )}
      <BookingList bookings={detail.bookings} now={detail.loadedAt} formatAt={bookingTime} />
    </div>
  );
}

/** Changes to their status, and every clinician they've been allocated. */
export function ClientHistory({ detail }: { detail: ClientDetail }) {
  const { matches, history } = detail;
  return (
    <div className="space-y-8">
      <Section title="Status changes">
        <HistoryList history={history} label={(s) => CLIENT_STATUS_LABELS[s as FamilyStatus] ?? s} formatAt={formatDateTime} />
      </Section>
      <Section title="Clinicians">
        {!matches.length ? (
          <Empty>No clinician allocated yet.</Empty>
        ) : (
          <Facts
            items={matches.map((m) => [
              m.clinician ?? "Clinician",
              <span key={m.id}>
                {MATCH_STATE_LABELS[m.state] ?? m.state} · {formatDateTime(m.offered_at)}
                {m.response_reason && <span className="text-neutral-500"> · {m.response_reason}</span>}
              </span>,
            ])}
          />
        )}
      </Section>
    </div>
  );
}
