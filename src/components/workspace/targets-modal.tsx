"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/components/forms";
import { DotsIcon } from "@/components/workspace/icons";
import { Modal } from "@/components/workspace/modal";

export interface TargetField {
  name: string;
  label: string;
  unit: string;
  value: number | null | undefined;
  max?: number;
  step?: string;
}

/** The ⋯ button in a summary page's header, and the targets it opens (time per step, and the KPI targets). */
export function TargetsButton({
  title,
  stepHelp,
  steps,
  kpis,
  action,
  canEdit,
}: {
  title: string;
  stepHelp: string;
  steps: TargetField[];
  kpis: TargetField[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Remount the form each time the modal opens, so it starts from the saved values.
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        className="inline-flex size-10 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
        aria-label={title}
        aria-haspopup="dialog"
        title="Settings"
      >
        <DotsIcon className="size-5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} subtitle="Targets for each onboarding step and for the numbers at the top of the page.">
        <TargetsForm key={key} stepHelp={stepHelp} steps={steps} kpis={kpis} action={action} canEdit={canEdit} />
      </Modal>
    </>
  );
}

function TargetsForm({
  stepHelp,
  steps,
  kpis,
  action,
  canEdit,
}: {
  stepHelp: string;
  steps: TargetField[];
  kpis: TargetField[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-8" noValidate>
      {!canEdit && <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">Only admins can change targets.</p>}

      <fieldset disabled={!canEdit} className="space-y-3">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Time allowed in each step</legend>
        <p className="text-sm text-neutral-500">{stepHelp}</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {steps.map((f) => (
            <NumberField key={f.name} {...f} />
          ))}
        </div>
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-3">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Key number targets</legend>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {kpis.map((f) => (
            <NumberField key={f.name} {...f} />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {state.error && (
          <p role="alert" className="mr-auto text-sm text-red-800">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="mr-auto text-sm text-emerald-800">
            {state.message}
          </p>
        )}
        {canEdit && <SaveButton />}
      </div>
    </form>
  );
}

function NumberField({
  name,
  label,
  unit,
  value,
  max,
  step = "1",
}: TargetField) {
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id} className="text-neutral-800">
        {label}
      </label>
      <span className="mt-1 flex items-center gap-2">
        <input
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step={step}
          defaultValue={value ?? ""}
          aria-describedby={`${id}-unit`}
          className="min-h-10 w-28 rounded-md border border-neutral-300 bg-white px-3 tabular-nums focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500"
        />
        <span id={`${id}-unit`} className="text-neutral-500">
          {unit}
        </span>
      </span>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-md bg-neutral-950 px-5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60">
      {pending ? "Saving…" : "Save targets"}
    </button>
  );
}
