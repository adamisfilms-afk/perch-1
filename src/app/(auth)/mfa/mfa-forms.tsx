"use client";

import { useActionState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, Input } from "@/components/ui";
import { startEnrol, verifyCode } from "./actions";

export function VerifyForm({ factorId, next }: { factorId: string; next: string }) {
  return (
    <ActionForm action={verifyCode}>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <Field label="Code" name="code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus />
      </Field>
      <SubmitButton pendingText="Checking…" className="w-full">
        Verify
      </SubmitButton>
    </ActionForm>
  );
}

export function EnrolForm({ next }: { next: string }) {
  const [state, start, pending] = useActionState(startEnrol, {});
  const v = state.values as { factorId: string; qr: string; secret: string } | undefined;
  if (!v) {
    return (
      <form action={start} className="space-y-3">
        {state.error && <Alert tone="red">{state.error}</Alert>}
        <button type="submit" disabled={pending} className="min-h-11 w-full rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">
          {pending ? "Starting…" : "Set up my authenticator app"}
        </button>
      </form>
    );
  }
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">
        <li>Scan this code with your authenticator app.</li>
        <li>Type in the 6-digit code it shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Supabase */}
      <img src={v.qr} alt="QR code for your authenticator app" className="mx-auto size-48" />
      <details className="text-sm">
        <summary className="cursor-pointer text-brand-700">Can&apos;t scan it?</summary>
        <p className="mt-2 break-all font-mono text-xs">{v.secret}</p>
      </details>
      <VerifyForm factorId={v.factorId} next={next} />
    </div>
  );
}
