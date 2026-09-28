// The tabs of a clinician's record (Info, Documents, Bookings, History), shared by the summary modal and the full record page.
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyLink } from "@/components/workspace/copy-link";
import { BookingList, Empty, Facts, HistoryList, Section, type Booking } from "@/components/workspace/detail-parts";
import type { TabDef } from "@/components/workspace/tabs";
import { CLIENT_STATUS_LABELS } from "@/lib/client-summary";
import {
  AGE_GROUP_LABELS,
  CLINICIAN_STATUS_LABELS,
  CREDENTIALS,
  FUNDING_LABELS,
  applicationGapLabel,
  goLiveGapLabel,
  requiredCredentialTypes,
  type AgeGroup,
  type ClinicianStatus,
  type CredentialType,
} from "@/lib/domain";
import { WEEKDAYS } from "@/lib/booking/settings";
import { formatAuMobile } from "@/lib/phone";
import { formatDate, formatDateTime } from "@/lib/time";
import type { ClinicianDetail } from "./actions";
import { IntakeCallForm } from "./intake-call-form";

/** Info first, then Documents (with a red count of anything out of date). */
export function clinicianTabs(detail: ClinicianDetail | null): TabDef[] {
  return [
    { id: "info", label: "Info" },
    { id: "documents", label: "Documents", alert: detail?.outOfDate ?? 0, alertTitle: "Documents out of date" },
    { id: "bookings", label: "Bookings" },
    { id: "history", label: "History" },
  ];
}

const DOC_STATUS: Record<string, string> = { pending: "Uploaded, to check", verified: "Verified", expired: "Expired", rejected: "Rejected" };
const bookingTime = (b: Booking) => (b.dateOnly ? formatDate(b.at) : formatDateTime(b.at));

/** Onboarding progress, contact details, profile and current clients. */
export function ClinicianInfo({
  detail,
  onboarding,
  canRecordIntake,
  onChanged,
}: {
  detail: ClinicianDetail;
  onboarding: boolean;
  canRecordIntake: boolean;
  onChanged?: () => void;
}) {
  const { clinician: c, applicationGaps, goLiveGaps, clients } = detail;
  const screeningAt = typeof c.application.screening_at === "string" ? c.application.screening_at : null;
  const toGoLive = goLiveGaps.filter((g) => g !== "clinical_lead_approval");

  return (
    <div className="space-y-8">
      {onboarding && (
        <Section title="Onboarding">
          <Facts
            items={[
              ["Signed up", formatDateTime(c.created_at)],
              ["Application", c.application_submitted_at ? `Submitted ${formatDateTime(c.application_submitted_at)}` : "Not submitted yet"],
              ["Intake call", screeningAt ? `Booked for ${formatDateTime(screeningAt)}` : c.application_submitted_at ? "Not booked yet" : null],
            ]}
          />
          {!c.application_submitted_at && applicationGaps.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="text-neutral-500">Still to do on their Perch page</p>
              <ul className="mt-1 list-disc pl-5 text-neutral-900">
                {applicationGaps.map((g) => (
                  <li key={g}>{applicationGapLabel(g)}</li>
                ))}
              </ul>
            </div>
          )}
          {c.application_submitted_at && (
            <div className="mt-4 space-y-3 text-sm">
              {toGoLive.length > 0 ? (
                <div>
                  <p className="text-neutral-500">Before they can go live</p>
                  <ul className="mt-1 list-disc pl-5 text-neutral-900">
                    {toGoLive.map((g) => (
                      <li key={g}>{goLiveGapLabel(g)}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-emerald-800">Documents verified: ready for the intake call to be recorded.</p>
              )}
              {canRecordIntake ? (
                <IntakeCallForm clinicianId={c.id} onDone={onChanged} />
              ) : (
                <p className="text-neutral-500">A clinical lead or admin records the intake call, which makes them ready for clients.</p>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Contact">
        <Facts
          items={[
            ["Email", <a key="e" href={`mailto:${c.email}`} className="underline underline-offset-4">{c.email}</a>],
            ["Mobile", c.mobile ? <a key="m" href={`tel:${c.mobile}`} className="underline underline-offset-4">{formatAuMobile(c.mobile)}</a> : null],
            ["Location", [c.suburb, c.postcode].filter(Boolean).join(" ") || null],
            ["Signed up", formatDateTime(c.created_at)],
            ["Status in the system", CLINICIAN_STATUS_LABELS[c.status as ClinicianStatus]],
          ]}
        />
      </Section>

      <Section title="Profile">
        <Facts
          items={[
            ["Experience", c.experience_years !== null ? `${c.experience_years} years` : null],
            ["Ages", c.age_groups.map((a) => AGE_GROUP_LABELS[a as AgeGroup] ?? a).join(", ") || null],
            ["Funding", c.funding_types.map((f) => FUNDING_LABELS[f]).join(", ") || null],
            ["Home visits", c.home_visits ? "Yes" : "No"],
            ["Telehealth", c.telehealth ? "Yes" : "No"],
            ["Capacity", `${c.capacity_new} new ${c.capacity_new === 1 ? "client" : "clients"}`],
          ]}
        />
      </Section>

      <Section title="Intro-call availability">
        <Facts
          items={[
            ...WEEKDAYS.filter(([d]) => detail.availability.some((w) => w.day === d)).map(
              ([d, label]) =>
                [
                  label,
                  detail.availability
                    .filter((w) => w.day === d)
                    .map((w) => `${w.start}–${w.end}`)
                    .join(", "),
                ] as [string, ReactNode],
            ),
            ...(detail.availability.length ? [] : ([["Hours", "None set yet"]] as [string, ReactNode][])),
            ["Time zone", c.timezone.replace("Australia/", "").replace("_", " ")],
          ]}
        />
        <div className="mt-3">
          <CopyLink label="Their private Perch page (no login)" url={detail.links.clinicianPage} />
        </div>
      </Section>

      <Section title="Clients">
        {!clients.length ? (
          <Empty>No clients allocated yet.</Empty>
        ) : (
          <Facts
            items={clients.map((cl) => [
              cl.name,
              <span key={cl.family_id} className="flex flex-wrap justify-between gap-2">
                {CLIENT_STATUS_LABELS[cl.status]}
                <Link href={`/families/${cl.family_id}`} className="text-neutral-500 underline-offset-4 hover:underline">
                  Open
                </Link>
              </span>,
            ])}
          />
        )}
      </Section>
    </div>
  );
}

/** Everything they've given us: registration, checks, insurance, CV and the signed agreement. */
export function ClinicianDocuments({ detail }: { detail: ClinicianDetail }) {
  const { clinician: c, documents, agreements } = detail;
  const required = requiredCredentialTypes(c.profession, c.home_visits);
  const shown: CredentialType[] = [...required, ...documents.map((d) => d.type).filter((t) => !required.includes(t))];
  const signed = agreements.find((a) => a.signed_at);

  return (
    <div className="space-y-8">
      <Section title="Documents">
        <ul className="divide-y divide-neutral-100 text-sm">
          {shown.map((t) => {
            const d = documents.find((x) => x.type === t);
            return (
              <li key={t} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2">
                <span>
                  <span className="text-neutral-900">{CREDENTIALS[t].label}</span>
                  {!required.includes(t) && <span className="text-neutral-400"> · optional</span>}
                  {d && (
                    <span className="block text-neutral-500">
                      {d.sighted_only ? "Sighted" : "Uploaded"} {formatDate(d.created_at)}
                      {d.number && ` · ${d.number}`}
                      {d.expires_at && ` · expires ${formatDate(d.expires_at)}`}
                    </span>
                  )}
                </span>
                <span className="flex items-start gap-3">
                  {d?.has_file && (
                    <a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="text-neutral-500 underline underline-offset-4 hover:text-neutral-900">
                      Open
                    </a>
                  )}
                  <DocumentTag status={d ? d.status : null} outOfDate={!!d?.out_of_date} />
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Service agreement">
        <Facts
          items={[
            [
              "Signed",
              signed ? `${formatDateTime(signed.signed_at!)} (version ${signed.version}${signed.documenso_ref ? ", via Documenso" : ", accepted in the portal"})` : null,
            ],
          ]}
        />
      </Section>
    </div>
  );
}

function DocumentTag({ status, outOfDate }: { status: string | null; outOfDate: boolean }) {
  const label = outOfDate ? "Out of date" : status ? DOC_STATUS[status] : "Not uploaded";
  const tone = outOfDate || status === "rejected" ? "bg-red-100 text-red-800" : status === "verified" ? "bg-emerald-100 text-emerald-900" : status === "pending" ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-500";
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-1 text-xs leading-none ${tone}`}>{label}</span>;
}

/** Their intake call, and intro calls and first sessions with their clients: upcoming first, then past. */
export function ClinicianBookings({ detail }: { detail: ClinicianDetail }) {
  return (
    <div className="space-y-8">
      {detail.links.intakeCall && (
        <Section title="Booking links">
          <CopyLink label="Intake call booking page" url={detail.links.intakeCall} />
          <p className="mt-2 text-xs text-neutral-500">They were emailed this link when they submitted their application.</p>
        </Section>
      )}
      <BookingList bookings={detail.bookings} now={detail.loadedAt} formatAt={bookingTime} />
    </div>
  );
}

export function ClinicianHistory({ detail }: { detail: ClinicianDetail }) {
  return (
    <Section title="Status changes">
      <HistoryList history={detail.history} label={(s) => CLINICIAN_STATUS_LABELS[s as ClinicianStatus] ?? s} formatAt={formatDateTime} />
    </Section>
  );
}
