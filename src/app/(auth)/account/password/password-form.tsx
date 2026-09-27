"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { setPassword } from "./actions";

export function PasswordForm() {
  return (
    <ActionForm action={setPassword}>
      <Field label="New password" name="password">
        <Input name="password" type="password" autoComplete="new-password" minLength={12} />
      </Field>
      <Field label="Type it again" name="confirm">
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full">Save password</SubmitButton>
    </ActionForm>
  );
}
