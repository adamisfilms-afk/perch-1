"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { completeIntake } from "./[id]/actions";
import type { ActionState } from "@/components/forms";

/** Records the clinician's intake call. Makes them ready for clients if their documents are verified. */
export function IntakeCallForm({ clinicianId, onDone }: { clinicianId: string; onDone?: () => void }) {
  const router = useRouter();
  const notesId = useId();
  const [state, action] = useActionState<ActionState, FormData>(completeIntake.bind(null, clinicianId), {});
  // Each result is handled once, even though onDone is a new function on every render.
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
    onDone?.();
  }, [state, router, onDone]);
  return (
    <form action={action} className="space-y-3 rounded-md border border-neutral-200 p-3" noValidate>
      <label htmlFor={notesId} className="block text-neutral-600">
        Intake call notes
      </label>
      <textarea id={notesId} name="notes" maxLength={4000} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      {state.error && (
        <p className="text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <RecordButton />
    </form>
  );
}

function RecordButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40">
      {pending ? "Saving…" : "Save/Complete intake call"}
    </button>
  );
}
