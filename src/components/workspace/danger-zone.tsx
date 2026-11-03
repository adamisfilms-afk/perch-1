"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/components/forms";
import { Modal } from "./modal";

/**
 * The bottom of a record: a red-bordered box with an irreversible action, confirmed by typing the record's name
 * (like Reddit's). The action redirects away on success.
 */
export function DangerZone({
  title,
  description,
  buttonLabel,
  confirmName,
  action,
  allowed,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  /** What they type to confirm. */
  confirmName: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** Only admins can delete; everyone else sees why the button is off. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const matches = typed.trim().toLowerCase() === confirmName.trim().toLowerCase();

  return (
    <section aria-labelledby="danger-zone" className="rounded-lg border border-red-300">
      <h2 id="danger-zone" className="border-b border-red-200 px-5 py-3 text-sm font-semibold text-red-800">
        Danger zone
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0 max-w-xl text-sm">
          <p className="font-medium text-neutral-900">{title}</p>
          <p className="text-neutral-600">{description}</p>
          {!allowed && <p className="mt-1 text-neutral-500">Only an admin can do this.</p>}
        </div>
        <button
          type="button"
          disabled={!allowed}
          onClick={() => {
            setTyped("");
            setOpen(true);
          }}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:border-red-700 hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-red-700"
        >
          {buttonLabel}
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={title} subtitle="This can't be undone.">
        <form action={formAction} className="space-y-4 text-sm">
          <p className="text-neutral-700">{description}</p>
          <label className="block space-y-1">
            <span className="text-neutral-700">
              Type <strong className="font-semibold">{confirmName}</strong> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
              className="min-h-10 w-full rounded-md border border-neutral-300 px-3 focus:border-neutral-900 focus:outline-none"
            />
          </label>
          {state.error && (
            <p className="text-red-800" role="alert">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-4 py-2 text-neutral-600 hover:text-neutral-900">
              Cancel
            </button>
            <button type="submit" disabled={!matches || pending} className="rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-40">
              {pending ? "Deleting…" : buttonLabel}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
