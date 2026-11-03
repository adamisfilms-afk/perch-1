"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/components/forms";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";

export interface SessionLogType {
  key: string;
  label: string;
  price_cents: number;
}

export interface SessionLogEntry {
  id: string;
  session_date: string;
  label: string;
  price_cents: number;
  status: "logged" | "voided";
  void_reason: string | null;
  logged_by: "clinician" | "staff";
  client?: string;
}

/**
 * Log a session (date and type) and see the sessions logged so far, with "Remove" for a mistake.
 * Used by clinicians on a referral page and by staff on a client's record. Leave out logAction for a read-only list.
 */
export function SessionLog({
  types,
  sessions,
  logAction,
  voidAction,
  today,
  showClient = false,
}: {
  types: SessionLogType[];
  sessions: SessionLogEntry[];
  logAction?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  voidAction?: (sessionId: string, reason: string) => Promise<ActionState>;
  today: string;
  showClient?: boolean;
}) {
  const logged = sessions.filter((s) => s.status === "logged");
  const thisMonth = logged.filter((s) => s.session_date.slice(0, 7) === today.slice(0, 7));
  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-600">
        {logged.length} session{logged.length === 1 ? "" : "s"} logged ({formatMoney(logged.reduce((t, s) => t + s.price_cents, 0))})
        {thisMonth.length > 0 && `, ${thisMonth.length} this month`}.
      </p>
      {logAction && <LogForm types={types} action={logAction} today={today} />}
      {sessions.length > 0 && <SessionTable sessions={sessions} voidAction={voidAction} showClient={showClient} />}
    </div>
  );
}

function LogForm({ types, action, today }: { types: SessionLogType[]; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; today: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const form = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    form.current?.reset();
    router.refresh();
  }, [state, router]);
  return (
    <form ref={form} action={formAction} className="space-y-3 rounded-md border border-neutral-200 p-4">
      <p className="text-sm font-medium text-neutral-900">Log a session</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-sm">
          <span className="block text-neutral-600">Date</span>
          <input name="date" type="date" required max={today} defaultValue={today} className="min-h-10 rounded-md border border-neutral-300 bg-white px-3 tabular-nums focus:border-neutral-900 focus:outline-none" />
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 text-neutral-600">Session</legend>
          {types.map((t, i) => (
            <label key={t.key} className="flex items-center gap-2">
              <input type="radio" name="service_type" value={t.key} defaultChecked={i === 0} className="size-4" />
              <span>
                {t.label} <span className="text-neutral-500">· {formatMoney(t.price_cents)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60">
          {pending ? "Saving…" : "Log session"}
        </button>
        {state.ok && state.message && (
          <span className="text-sm text-emerald-800" role="status">
            {state.message}
          </span>
        )}
        {state.error && (
          <span className="text-sm text-red-800" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function SessionTable({
  sessions,
  voidAction,
  showClient,
}: {
  sessions: SessionLogEntry[];
  voidAction?: (sessionId: string, reason: string) => Promise<ActionState>;
  showClient: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remove = (s: SessionLogEntry) => {
    if (!voidAction) return;
    const reason = window.prompt(`Remove the session on ${formatDate(s.session_date)}? Say why (for example "logged twice"):`);
    if (!reason?.trim()) return;
    start(async () => {
      setError(null);
      const r = await voidAction(s.id, reason.trim());
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
              <th scope="col" className="py-2 pr-4 font-normal">Date</th>
              {showClient && <th scope="col" className="py-2 pr-4 font-normal">Client</th>}
              <th scope="col" className="py-2 pr-4 font-normal">Session</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">Price</th>
              <th scope="col" className="py-2 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className={`border-b border-neutral-100 ${s.status === "voided" ? "text-neutral-400" : "text-neutral-800"}`}>
                <td className="py-2 pr-4 tabular-nums">
                  <span className={s.status === "voided" ? "line-through" : undefined}>{formatDate(s.session_date)}</span>
                </td>
                {showClient && <td className="py-2 pr-4">{s.client ?? ""}</td>}
                <td className="py-2 pr-4">
                  {s.label}
                  {s.status === "voided" && <span className="block text-xs">Removed: {s.void_reason}</span>}
                  {s.status === "logged" && s.logged_by === "staff" && <span className="block text-xs text-neutral-500">Logged by the Perch team</span>}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(s.price_cents)}</td>
                <td className="py-2 text-right">
                  {voidAction && s.status === "logged" && (
                    <button type="button" onClick={() => remove(s)} disabled={pending} className="text-sm text-neutral-500 underline-offset-4 hover:text-red-800 hover:underline">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
