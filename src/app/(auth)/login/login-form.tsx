"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  return (
    <ActionForm action={signIn}>
      {({ values = {} }) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email">
            <Input name="email" type="email" autoComplete="username" defaultValue={(values.email as string) ?? ""} />
          </Field>
          <Field label="Password" name="password">
            <Input name="password" type="password" autoComplete="current-password" />
          </Field>
          <SubmitButton pendingText="Logging in…" className="w-full">
            Log in
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
