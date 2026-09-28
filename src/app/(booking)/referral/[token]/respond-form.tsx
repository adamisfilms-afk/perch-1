"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input } from "@/components/ui";

export function RespondForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action}>
      <Field label="Anything to add? (optional)" name="reason" hint="If you're declining, a quick reason helps us match better">
        <Input name="reason" maxLength={500} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton name="decision" value="accept" pendingText="Sending…">
          Accept
        </SubmitButton>
        <SubmitButton name="decision" value="decline" variant="secondary" pendingText="Sending…">
          Decline
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
