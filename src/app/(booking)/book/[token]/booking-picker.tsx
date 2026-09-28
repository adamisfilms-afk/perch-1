"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { cn } from "@/components/ui";
import { book, cancel } from "./actions";

const noSubscribe = () => () => {};

/** Pick a day, then a time. Times show in the visitor's own time zone. */
export function BookingPicker({
  token,
  slots,
  existing,
  minutes,
}: {
  token: string;
  slots: string[];
  existing: { id: string; startsAt: string; hostName: string } | null;
  minutes: number;
}) {
  const router = useRouter();
  // The visitor's time zone. Null while rendering on the server, so times are only shown in the browser.
  const tz = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const [picking, setPicking] = useState(!existing);
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const days = useMemo(() => {
    if (!tz) return [];
    const byDay = new Map<string, string[]>();
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    for (const s of slots) {
      const k = key.format(new Date(s));
      byDay.set(k, [...(byDay.get(k) ?? []), s]);
    }
    return [...byDay.entries()];
  }, [slots, tz]);

  if (!tz) return <p className="text-sm text-neutral-500">Loading times…</p>;

  const fmtDay = (ymd: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${ymd}T00:00:00Z`));
  const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const fmtFull = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(
      new Date(iso),
    );
  const activeDay = day ?? days[0]?.[0] ?? null;
  const times = days.find(([d]) => d === activeDay)?.[1] ?? [];

  const confirm = () =>
    chosen &&
    start(async () => {
      setError(null);
      const r = await book(token, chosen);
      if (!r.ok) {
        setError(r.error);
        router.refresh();
        return;
      }
      setDone(`You're booked for ${fmtFull(r.startsAt)}. We've emailed you the details.`);
      setPicking(false);
      setChosen(null);
      router.refresh();
    });

  const cancelBooking = () => {
    if (!window.confirm("Cancel this call?")) return;
    start(async () => {
      setError(null);
      const r = await cancel(token);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone("Your call has been cancelled. You can choose a new time below.");
      setPicking(true);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {done && (
        <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          {done}
        </p>
      )}

      {existing && !picking && (
        <div className="space-y-3 rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">Your call</p>
          <p className="font-medium">{fmtFull(existing.startsAt)}</p>
          <p className="text-sm text-neutral-600">
            {minutes} minutes with {existing.hostName}. We&apos;ll call your mobile.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPicking(true)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              Change time
            </button>
            <button type="button" onClick={cancelBooking} disabled={pending} className="rounded-md px-3 py-1.5 text-sm text-red-800 hover:bg-red-50">
              Cancel call
            </button>
          </div>
        </div>
      )}

      {picking && (
        <div className="space-y-5">
          {!days.length ? (
            <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
              There are no free times in the next few weeks. Please reply to our email and we&apos;ll find a time with you.
            </p>
          ) : (
            <>
              <div>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Choose a day</h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {days.map(([d, ts]) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDay(d);
                        setChosen(null);
                      }}
                      aria-pressed={d === activeDay}
                      className={cn(
                        "shrink-0 rounded-md border px-3 py-2 text-left text-sm",
                        d === activeDay ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:border-neutral-400",
                      )}
                    >
                      <span className="block whitespace-nowrap">{fmtDay(d)}</span>
                      <span className={cn("block text-xs", d === activeDay ? "text-neutral-300" : "text-neutral-500")}>{ts.length} times</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Choose a time <span className="normal-case tracking-normal">({tz.replace("_", " ")})</span>
                </h2>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {times.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setChosen(t)}
                      aria-pressed={t === chosen}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm tabular-nums",
                        t === chosen ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:border-neutral-400",
                      )}
                    >
                      {fmtTime(t)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!chosen || pending}
                  className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                >
                  {pending ? "Booking…" : existing ? "Move my call to this time" : "Book this time"}
                </button>
                {chosen && <span className="text-sm text-neutral-600">{fmtFull(chosen)}</span>}
                {existing && (
                  <button type="button" onClick={() => setPicking(false)} className="text-sm text-neutral-600 hover:text-neutral-900">
                    Keep my current time
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
