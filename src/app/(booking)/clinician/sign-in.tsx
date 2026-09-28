"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/components/forms";
import { requestCode, verifyCode } from "./sign-in-actions";

const input = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none";
const primary = "rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40";

/**
 * Step 1: email (or, from an emailed link, just a button). Step 2: the 6-digit code.
 * `token` is the signed link they arrived with, if any; `maskedEmail` shows where the code will go.
 */
export function ClinicianSignIn({ token, maskedEmail }: { token: string | null; maskedEmail: string | null }) {
  const [sent, send, sending] = useActionState<ActionState, FormData>(requestCode, {});
  const [checked, check, checking] = useActionState<ActionState, FormData>(verifyCode, {});
  const [typedEmail, setTypedEmail] = useState("");
  const useLink = !!token && !!maskedEmail;
  const codeSent = !!sent.ok;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in to your Perch page</h1>
        <p className="mt-2 text-sm text-neutral-600">
          To keep your details safe, we&apos;ll email you a 6-digit code. You&apos;ll stay signed in on this device for 30 days.
        </p>
      </div>

      {!codeSent ? (
        <form action={send} className="space-y-3">
          {useLink ? (
            <input type="hidden" name="token" value={token} />
          ) : (
            <label className="block space-y-1 text-sm">
              <span className="text-neutral-700">Email</span>
              <input name="email" type="email" autoComplete="email" required value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} className={input} />
            </label>
          )}
          <button type="submit" disabled={sending} className={primary}>
            {sending ? "Sending…" : useLink ? `Email a code to ${maskedEmail}` : "Email me a code"}
          </button>
          {sent.error && (
            <p className="text-sm text-red-800" role="alert">
              {sent.error}
            </p>
          )}
        </form>
      ) : (
        <form action={check} className="space-y-3">
          <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            {sent.message} It works for 10 minutes.
          </p>
          {useLink ? <input type="hidden" name="token" value={token} /> : <input type="hidden" name="email" value={typedEmail} />}
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-700">6-digit code</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              autoFocus
              className={`${input} max-w-40 tracking-widest tabular-nums`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={checking} className={primary}>
              {checking ? "Checking…" : "Sign in"}
            </button>
            <button type="submit" formAction={send} formNoValidate className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900">
              Send a new code
            </button>
          </div>
          {checked.error && (
            <p className="text-sm text-red-800" role="alert">
              {checked.error}
            </p>
          )}
        </form>
      )}

      <p className="text-xs text-neutral-500">Having trouble? Reply to any email from us and the team will help.</p>
    </div>
  );
}
