"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/components/forms";
import { AU_TIMEZONES, WEEKDAYS } from "@/lib/booking/settings";

export interface HoursWindow {
  day: number;
  start: string;
  end: string;
}

const inputClass = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm tabular-nums";

/**
 * Weekly hours: a row per weekday with any number of time ranges, plus a time zone.
 * Submits `timezone` and `windows` (JSON) to `action`; `children` adds extra fields to the same form.
 */
export function WeeklyHoursEditor({
  initial,
  timezone,
  action,
  children,
  saveLabel = "Save hours",
}: {
  initial: HoursWindow[];
  timezone: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  saveLabel?: string;
}) {
  const [rows, setRows] = useState<(HoursWindow & { key: number })[]>(() => initial.map((w, i) => ({ ...w, key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  const [state, formAction] = useActionState(action, {});

  const add = (day: number) => {
    const last = rows.filter((r) => r.day === day).at(-1);
    setRows([...rows, { day, start: last ? last.end : "15:00", end: last ? last.end : "18:00", key: nextKey }]);
    setNextKey(nextKey + 1);
  };
  const update = (key: number, field: "start" | "end", value: string) => setRows(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const remove = (key: number) => setRows(rows.filter((r) => r.key !== key));

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="windows" value={JSON.stringify(rows.map(({ day, start, end }) => ({ day, start, end })))} />
      {children}
      <label className="block text-sm">
        <span className="text-neutral-600">Time zone</span>
        <select name="timezone" defaultValue={timezone} className={`${inputClass} mt-1 block`}>
          {AU_TIMEZONES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <ul className="divide-y divide-neutral-100 text-sm">
        {WEEKDAYS.map(([day, label]) => {
          const mine = rows.filter((r) => r.day === day);
          return (
            <li key={day} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2">
              <span className="pt-1.5 text-neutral-800">{label}</span>
              <div className="space-y-2">
                {mine.length === 0 && <p className="pt-1.5 text-neutral-400">Unavailable</p>}
                {mine.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <input type="time" step={900} value={r.start} onChange={(e) => update(r.key, "start", e.target.value)} className={inputClass} aria-label={`${label} from`} />
                    <span className="text-neutral-400">to</span>
                    <input type="time" step={900} value={r.end} onChange={(e) => update(r.key, "end", e.target.value)} className={inputClass} aria-label={`${label} until`} />
                    <button type="button" onClick={() => remove(r.key)} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label={`Remove ${label} ${r.start} to ${r.end}`}>
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => add(day)} className="text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline">
                  + Add hours
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton label={saveLabel} />
        {state.error && (
          <p className="text-sm text-red-800" role="alert">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-sm text-emerald-800" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40">
      {pending ? "Saving…" : label}
    </button>
  );
}

/** Days off: a list with remove buttons, and a form to add a date range. */
export function TimeOffEditor({
  items,
  addAction,
  removeAction,
}: {
  items: { id: string; starts_on: string; ends_on: string; note: string | null }[];
  addAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  removeAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [addState, add] = useActionState(addAction, {});
  const [removeState, remove] = useActionState(removeAction, {});
  const fmt = (d: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));
  return (
    <div className="space-y-4 text-sm">
      {items.length === 0 ? (
        <p className="text-neutral-500">No days off coming up.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {fmt(t.starts_on)}
                {t.ends_on !== t.starts_on && ` – ${fmt(t.ends_on)}`}
                {t.note && <span className="text-neutral-500"> · {t.note}</span>}
              </span>
              <form action={remove}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {removeState.error && <p className="text-red-800">{removeState.error}</p>}
      <form action={add} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-neutral-600">From</span>
          <input type="date" name="starts_on" required className={inputClass} />
        </label>
        <label>
          <span className="block text-neutral-600">To</span>
          <input type="date" name="ends_on" required className={inputClass} />
        </label>
        <label className="min-w-40 flex-1">
          <span className="block text-neutral-600">Note (optional)</span>
          <input type="text" name="note" maxLength={200} className={`${inputClass} w-full`} />
        </label>
        <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
          Add days off
        </button>
      </form>
      {addState.error && <p className="text-red-800">{addState.error}</p>}
    </div>
  );
}
