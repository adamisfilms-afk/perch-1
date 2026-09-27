"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { confirmByToken } from "./actions";

export function FirstSessionTokenForm({ token }: { token: string }) {
  return (
    <ActionForm action={confirmByToken.bind(null, token)}>
      {(state) =>
        state.ok ? null : (
          <>
            <Field label="Date of the first session" name="date">
              <Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <SubmitButton className="w-full">Yes, it&apos;s booked</SubmitButton>
            <p className="text-xs text-stone-500">Not booked yet? No need to do anything now. You can confirm it later from your portal.</p>
          </>
        )
      }
    </ActionForm>
  );
}
