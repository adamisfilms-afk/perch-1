"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/components/forms";
import { answer } from "./actions";

/** "Yes, that's right" or "No": with a note saying what's different. */
export function AnswerForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(answer.bind(null, token), {});
  const [disagree, setDisagree] = useState(false);
  if (state.ok) {
    return (
      <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      {disagree && (
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-700">What&apos;s different? For example, how many sessions you had, or which dates.</span>
          <textarea name="note" rows={3} maxLength={1000} required autoFocus className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {!disagree ? (
          <>
            <button type="submit" name="answer" value="yes" disabled={pending} className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40">
              Yes, that&apos;s right
            </button>
            <button type="button" onClick={() => setDisagree(true)} className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50">
              No, that&apos;s not right
            </button>
          </>
        ) : (
          <>
            <button type="submit" name="answer" value="no" disabled={pending} className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40">
              {pending ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setDisagree(false)} className="rounded-md px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">
              Back
            </button>
          </>
        )}
      </div>
      {state.error && (
        <p className="text-sm text-red-800" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
