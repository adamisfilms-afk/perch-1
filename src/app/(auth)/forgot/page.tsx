"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input } from "@/components/ui";
import { sendReset } from "../login/actions";

export default function ForgotPage() {
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <ActionForm action={sendReset}>
        <Field label="Email" name="email">
          <Input name="email" type="email" autoComplete="username" />
        </Field>
        <SubmitButton pendingText="Sending…" className="w-full">
          Send reset link
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
