"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/components/forms";
import { Modal } from "./modal";

type FormRender = (state: ActionState) => ReactNode;

/**
 * The dark header button (e.g. "New contact") that opens a form in a pop-up. On success the pop-up closes and the
 * page refreshes; the form starts empty each time it opens.
 */
export function NewRecordButton({
  label,
  title,
  subtitle,
  submitLabel,
  action,
  children,
}: {
  label: string;
  title: string;
  subtitle?: ReactNode;
  submitLabel: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: FormRender;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  return (
    <>
      {done && (
        <span role="status" className="text-sm text-emerald-800">
          {done}
        </span>
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setKey((k) => k + 1);
          setDone(null);
          setOpen(true);
        }}
        className="inline-flex min-h-8 items-center whitespace-nowrap rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800"
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} subtitle={subtitle}>
        <RecordForm
          key={key}
          action={action}
          submitLabel={submitLabel}
          onDone={(message) => {
            setOpen(false);
            setDone(message);
          }}
          onCancel={() => setOpen(false)}
        >
          {children}
        </RecordForm>
      </Modal>
    </>
  );
}

function RecordForm({
  action,
  submitLabel,
  onDone,
  onCancel,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel: string;
  onDone: (message: string) => void;
  onCancel: () => void;
  children: FormRender;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
    onDone(state.message ?? "Saved");
  }, [state, router, onDone]);
  return (
    <form action={formAction} className="space-y-8" noValidate>
      {children(state)}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {state.error && (
          <p role="alert" className="mr-auto text-sm text-red-800">
            {state.error}
          </p>
        )}
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">
          Cancel
        </button>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-md bg-neutral-950 px-5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60">
      {pending ? "Saving…" : label}
    </button>
  );
}
