"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/components/forms";
import { updateScreeningNotes } from "./[id]/actions";

/** Notes from the clinician's intake call. Staff can add or edit them at any stage, before or after the call is recorded. */
export function IntakeNotesForm({ clinicianId, notes }: { clinicianId: string; notes: string | null }) {
  const router = useRouter();
  const id = useId();
  const [state, action] = useActionState<ActionState, FormData>(updateScreeningNotes.bind(null, clinicianId), {});
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-2">
      <label htmlFor={id} className="sr-only">
        Intake call notes
      </label>
      <textarea
        id={id}
        name="screening_notes"
        maxLength={4000}
        rows={4}
        defaultValue={notes ?? ""}
        placeholder="Anything from the intake call: experience, approach, availability, follow-ups…"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <SaveButton />
        {state.ok && <span className="text-sm text-emerald-800">Saved</span>}
        {state.error && (
          <span className="text-sm text-red-800" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40">
      {pending ? "Saving…" : "Save notes"}
    </button>
  );
}
