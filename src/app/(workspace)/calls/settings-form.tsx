"use client";

import { useActionState } from "react";
import type { ActionState } from "@/components/forms";
import type { BookingSettings } from "@/lib/booking/settings";

const FIELDS: [keyof BookingSettings, string, string][] = [
  ["signup_call_minutes", "Family sign-up call", "minutes"],
  ["clinician_intake_minutes", "Clinician intake call", "minutes"],
  ["intro_call_minutes", "Intro call with a clinician", "minutes"],
  ["min_notice_hours", "Minimum notice", "hours"],
  ["horizon_days", "Book up to", "days ahead"],
];

export function BookingSettingsForm({ settings, action }: { settings: BookingSettings; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3 text-sm" noValidate>
      {FIELDS.map(([name, label, unit]) => (
        <label key={name} className="grid grid-cols-[11rem_auto_1fr] items-center gap-3">
          <span className="text-neutral-600">{label}</span>
          <input
            type="number"
            name={name}
            min={0}
            step={1}
            defaultValue={settings[name]}
            className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 tabular-nums focus:border-neutral-900 focus:outline-none"
          />
          <span className="text-neutral-500">{unit}</span>
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-neutral-950 px-4 py-2 font-medium text-white hover:bg-neutral-800">
          Save settings
        </button>
        {state.error && <p className="text-red-800">{state.error}</p>}
        {state.ok && <p className="text-emerald-800">{state.message}</p>}
      </div>
    </form>
  );
}
