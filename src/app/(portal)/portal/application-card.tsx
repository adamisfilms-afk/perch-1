import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Checkbox, LinkButton } from "@/components/ui";
import { applicationGapLabel } from "@/lib/domain";
import { bookingUrl } from "@/lib/server/booking";
import { formatDateTime } from "@/lib/time";
import type { ClinicianRow } from "@/lib/types";
import { submitApplication } from "./actions";

export const AGREEMENT_VERSION = process.env.AGREEMENT_VERSION ?? "2026-09";

/** Onboarding steps for a clinician who isn't live yet: finish the application, then book the intake call. */
export function ApplicationCard({ me, gaps }: { me: ClinicianRow; gaps: string[] }) {
  if (!me.application_submitted_at) {
    const agreementUrl = process.env.AGREEMENT_URL;
    return (
      <Card>
        <CardTitle>Finish your application</CardTitle>
        {gaps.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-stone-600">Before you can submit, please:</p>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
              {gaps.map((g) => (
                <li key={g}>{applicationGapLabel(g)}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/portal/profile" size="sm">
                Complete your profile
              </LinkButton>
              <LinkButton href="/portal/documents" size="sm">
                Upload documents
              </LinkButton>
            </div>
          </>
        ) : (
          <ActionForm action={submitApplication.bind(null, AGREEMENT_VERSION)}>
            <p className="text-sm text-stone-600">Your profile and documents are in. Accept the service agreement to submit your application.</p>
            <Checkbox name="agree">
              I have read and accept the{" "}
              {agreementUrl ? (
                <a href={agreementUrl} target="_blank" rel="noreferrer" className="underline">
                  clinician service agreement
                </a>
              ) : (
                "clinician service agreement"
              )}{" "}
              (version {AGREEMENT_VERSION}).
            </Checkbox>
            <SubmitButton pendingText="Submitting…">Submit application</SubmitButton>
          </ActionForm>
        )}
      </Card>
    );
  }

  const screeningAt = typeof me.application.screening_at === "string" ? me.application.screening_at : null;
  const booking = bookingUrl("clinician_intake", me.id);
  return (
    <Card>
      <CardTitle>Intake call</CardTitle>
      {screeningAt ? (
        <p className="text-sm">
          Booked for <strong>{formatDateTime(screeningAt)}</strong>. We&apos;ll check your documents before the call.{" "}
          <a href={booking} className="underline">
            Change or cancel
          </a>
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-stone-600">Thanks for submitting your application. The next step is a short intake call with our team.</p>
          <LinkButton href={booking} size="sm">
            Book your intake call
          </LinkButton>
        </>
      )}
    </Card>
  );
}
