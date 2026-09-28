import type { ReactNode } from "react";
import { TimeOffEditor, WeeklyHoursEditor } from "@/components/booking/hours-editor";
import { ClinicianProfileForm } from "@/components/clinician-profile-form";
import { DocumentUploadForm } from "@/components/document-upload-form";
import { ActionForm, SimpleActionButton, SubmitButton } from "@/components/forms";
import { Checkbox } from "@/components/ui";
import { AGREEMENT_VERSION, agreementUrl } from "@/lib/agreement";
import { CREDENTIAL_TYPES, CREDENTIALS, applicationGapLabel, requiredCredentialTypes, type CredentialType } from "@/lib/domain";
import type { ClinicianPageView } from "@/lib/server/clinician-link";
import { daysSince, daysUntil, formatDate, formatDateTime, todayInAustralia } from "@/lib/time";
import { addDaysOff, confirmDetails, createUploadUrl, recordUpload, removeDaysOff, saveHours, saveProfile, submitApplication } from "./actions";

const heading = "mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400";

/** What a clinician sees on their own page. No family details. */
export function ClinicianPageBody({ view }: { view: ClinicianPageView }) {
  const c = view.clinician;
  const live = c.status === "active" || c.status === "paused";
  const firstName = c.name.split(" ")[0];
  const checkInDue = live && (!c.last_recredentialed_at || daysSince(c.last_recredentialed_at) > 330);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hi {firstName}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          This is your private Perch page. Keep the link to yourself: anyone with it can change your details. Lost it? Get it again at{" "}
          <a href="/link" className="underline underline-offset-4">
            the link page
          </a>
          .
        </p>
      </div>

      {c.status === "paused" && (
        <Notice tone="amber">
          New referrals are paused{c.pause_reason === "credentials" ? " until your documents are up to date" : ""}. Families you&apos;re already seeing stay with
          you.
        </Notice>
      )}

      {view.openReferrals.length > 0 && (
        <section>
          <h2 className={heading}>Referrals waiting for your answer</h2>
          <ul className="space-y-2">
            {view.openReferrals.map((r) => (
              <li key={r.url}>
                <a href={r.url} className="block rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:border-amber-500">
                  <span className="font-medium">
                    {r.childAge !== null ? `${r.childAge}-year-old` : "Child"} in {r.suburb}
                  </span>
                  {r.expiresAt && <span className="block text-neutral-600">Reply by {formatDateTime(r.expiresAt)}</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!live && <Application view={view} />}

      {live && (
        <section>
          <h2 className={heading}>Your clients</h2>
          <p className="text-sm text-neutral-700">
            You&apos;re seeing {view.activeClients} {view.activeClients === 1 ? "family" : "families"} we referred, and taking {c.capacity_new} more new{" "}
            {c.capacity_new === 1 ? "family" : "families"}
            {c.snoozed_until ? ` (not taking new referrals until ${formatDate(c.snoozed_until)})` : ""}. We email you each family&apos;s details when you accept
            them.
          </p>
          {checkInDue && (
            <div className="mt-4 space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-medium">Yearly check-in</p>
              <p>Please check your profile, capacity and documents below are still right, then confirm.</p>
              <SimpleActionButton action={confirmDetails.bind(null, view.token)} label="Everything's up to date" />
            </div>
          )}
        </section>
      )}

      <section id="hours">
        <h2 className={heading}>Your hours for intro calls</h2>
        <p className="mb-4 text-sm text-neutral-600">Families we match you with book a free {view.introMinutes}-minute phone call in these times.</p>
        <WeeklyHoursEditor initial={view.windows} timezone={c.timezone} action={saveHours.bind(null, view.token)} />
        <h3 className="mb-3 mt-8 text-sm font-medium text-neutral-700">Days off</h3>
        <TimeOffEditor items={view.timeOff} addAction={addDaysOff.bind(null, view.token)} removeAction={removeDaysOff.bind(null, view.token)} />
        {view.upcomingIntroCalls.length > 0 && (
          <>
            <h3 className="mb-2 mt-8 text-sm font-medium text-neutral-700">Intro calls booked</h3>
            <ul className="divide-y divide-neutral-100 text-sm">
              {view.upcomingIntroCalls.map((at) => (
                <li key={at} className="py-2 tabular-nums">
                  {formatDateTime(at, c.timezone)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-500">Who to call is in the email we sent you when they booked.</p>
          </>
        )}
      </section>

      <section id="profile">
        <h2 className={heading}>Your profile</h2>
        <p className="mb-4 text-sm text-neutral-600">We use this when we choose clinicians for families. Keep your capacity current.</p>
        <ClinicianProfileForm action={saveProfile.bind(null, view.token)} clinician={c} />
      </section>

      <Documents view={view} />
    </div>
  );
}

/** Before they go live: finish the application, then book the intake call. */
function Application({ view }: { view: ClinicianPageView }) {
  const c = view.clinician;
  const url = agreementUrl();
  return (
    <section>
      <h2 className={heading}>Your application</h2>
      {!c.application_submitted_at ? (
        view.applicationGaps.length > 0 ? (
          <div className="space-y-2 text-sm">
            <p className="text-neutral-600">Before you can submit, please:</p>
            <ul className="list-disc space-y-1 pl-5">
              {view.applicationGaps.map((g) => (
                <li key={g}>
                  <a href={g.startsWith("document:") ? "#documents" : g === "availability" ? "#hours" : "#profile"} className="underline underline-offset-4">
                    {applicationGapLabel(g)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ActionForm action={submitApplication.bind(null, view.token)}>
            <p className="text-sm text-neutral-600">Your profile, hours and documents are in. Accept the service agreement to submit your application.</p>
            <Checkbox name="agree">
              I have read and accept the{" "}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="underline">
                  clinician service agreement
                </a>
              ) : (
                "clinician service agreement"
              )}{" "}
              (version {AGREEMENT_VERSION}).
            </Checkbox>
            <SubmitButton pendingText="Submitting…">Submit application</SubmitButton>
          </ActionForm>
        )
      ) : view.intakeCall?.startsAt ? (
        <p className="text-sm">
          Thanks for applying. Your intake call is booked for <strong>{formatDateTime(view.intakeCall.startsAt)}</strong>. We&apos;ll check your documents
          before the call.{" "}
          <a href={view.intakeCall.url} className="underline underline-offset-4">
            Change or cancel
          </a>
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-neutral-600">Thanks for submitting your application. The next step is a short intake call with our team.</p>
          {view.intakeCall && (
            <a href={view.intakeCall.url} className="inline-block rounded-md bg-neutral-950 px-4 py-2 font-medium text-white hover:bg-neutral-800">
              Book your intake call
            </a>
          )}
        </div>
      )}
    </section>
  );
}

const DOC_STATUS: Record<string, string> = { pending: "Uploaded, to check", verified: "Verified", expired: "Expired", rejected: "Needs a new copy" };

function Documents({ view }: { view: ClinicianPageView }) {
  const c = view.clinician;
  const today = todayInAustralia();
  const required = requiredCredentialTypes(c.profession, c.home_visits);
  const uploadable = CREDENTIAL_TYPES.filter(
    (t) => !CREDENTIALS[t].sightedOnly && t !== "abn" && t !== (c.profession === "speech_pathologist" ? "ahpra" : "spa_cpsp"),
  );
  const shown: CredentialType[] = [...required, ...view.credentials.map((d) => d.type).filter((t) => !required.includes(t))];

  return (
    <section id="documents">
      <h2 className={heading}>Your documents</h2>
      <ul className="mb-6 divide-y divide-neutral-100 text-sm">
        {[...new Set(shown)].map((t) => {
          const d = view.credentials.find((x) => x.type === t);
          const soon = d?.status === "verified" && d.expires_at && daysUntil(d.expires_at, today) <= 60;
          return (
            <li key={t} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span>
                {CREDENTIALS[t].label}
                {!required.includes(t) && <span className="text-neutral-400"> · optional</span>}
                {d?.expires_at && <span className="block text-xs text-neutral-500">expires {formatDate(d.expires_at)}</span>}
                {d?.status === "rejected" && d.rejection_reason && <span className="block text-xs text-red-700">{d.rejection_reason}</span>}
                {CREDENTIALS[t].sightedOnly && !d && <span className="block text-xs text-neutral-500">The team sights this: nothing to upload</span>}
              </span>
              <Tag tone={!d ? "grey" : d.status === "verified" && !soon ? "green" : d.status === "pending" || soon ? "amber" : "red"}>
                {!d ? (CREDENTIALS[t].sightedOnly ? "To be sighted" : "Needed") : soon ? `Expires ${formatDate(d.expires_at!)}` : DOC_STATUS[d.status] ?? d.status}
              </Tag>
            </li>
          );
        })}
      </ul>
      <h3 className="mb-3 text-sm font-medium text-neutral-700">Upload a document</h3>
      <DocumentUploadForm
        types={uploadable.map((t) => [t, CREDENTIALS[t].label, CREDENTIALS[t].expiryTracked] as const)}
        createUploadUrl={createUploadUrl.bind(null, view.token)}
        recordUpload={recordUpload.bind(null, view.token)}
      />
    </section>
  );
}

function Tag({ tone, children }: { tone: "green" | "amber" | "red" | "grey"; children: ReactNode }) {
  const cls = { green: "bg-emerald-100 text-emerald-900", amber: "bg-amber-100 text-amber-900", red: "bg-red-100 text-red-800", grey: "bg-neutral-100 text-neutral-500" }[tone];
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-1 text-xs leading-none ${cls}`}>{children}</span>;
}

function Notice({ tone, children }: { tone: "amber"; children: ReactNode }) {
  return <p className={tone === "amber" ? "rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900" : ""}>{children}</p>;
}
