"use client";

import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { CheckboxGroup, Field, Input } from "./ui";

// Intro call outcome and first-session confirmation: used by clinicians in the portal
// and by staff recording on a clinician's behalf.

export function IntroOutcomeForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action}>
      <CheckboxGroup
        legend="How did the intro call go?"
        name="outcome"
        type="radio"
        options={[
          ["going_ahead", "Going ahead"],
          ["not_going_ahead", "Not going ahead"],
        ]}
      />
      <Field label="Reason (if not going ahead)" name="reason">
        <Input name="reason" maxLength={500} />
      </Field>
      <SubmitButton variant="secondary" size="sm">
        Save outcome
      </SubmitButton>
    </ActionForm>
  );
}

export function FirstSessionForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="First session date" name="date">
          <Input name="date" type="date" />
        </Field>
        <SubmitButton size="md">First session booked</SubmitButton>
      </div>
    </ActionForm>
  );
}
