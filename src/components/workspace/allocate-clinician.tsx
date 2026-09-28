"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { allocateClinician, listAllocatableClinicians, type AllocatableClinician } from "@/app/(workspace)/clients/actions";
import { PROFESSION_LABELS, PROFESSIONS } from "@/lib/domain";

/**
 * Shows who a client is allocated to, with "Allocate clinician" (or "Edit") to pick from the active clinicians.
 * Saving emails the family the clinician's intro-call link and tells the clinician to expect them.
 */
export function AllocateClinician({
  familyId,
  current,
  blockedReason,
  onAllocated,
}: {
  familyId: string;
  current: { id: string; name: string } | null;
  /** Set when the client can't be allocated yet (e.g. the sign-up call isn't done). */
  blockedReason?: string | null;
  onAllocated?: () => void;
}) {
  const router = useRouter();
  const selectId = useId();
  const [editing, setEditing] = useState(false);
  const [clinicians, setClinicians] = useState<AllocatableClinician[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!editing || clinicians) return;
    let cancelled = false;
    listAllocatableClinicians()
      .then((list) => !cancelled && setClinicians(list))
      .catch(() => !cancelled && setError("Couldn't load the clinicians. Try again."));
    return () => {
      cancelled = true;
    };
  }, [editing, clinicians]);

  const open = () => {
    setChoice(current?.id ?? "");
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await allocateClinician(familyId, choice);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setSaved(true);
      router.refresh();
      onAllocated?.();
    });

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {current ? (
              <span className="text-neutral-900">{current.name}</span>
            ) : (
              <span className="text-neutral-500">No clinician allocated</span>
            )}
          </p>
          {!blockedReason && (
            <button
              type="button"
              onClick={open}
              className={
                current
                  ? "rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50"
                  : "rounded-md bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
              }
            >
              {current ? "Edit" : "Allocate clinician"}
            </button>
          )}
        </div>
        {blockedReason && <p className="text-sm text-neutral-500">{blockedReason}</p>}
        {saved && (
          <p className="text-sm text-emerald-800" role="status">
            Saved. The family has been emailed a link to book their intro call, and the clinician has been told to expect them.
          </p>
        )}
      </div>
    );
  }

  const byProfession = PROFESSIONS.map((p) => [p, (clinicians ?? []).filter((c) => c.profession === p)] as const).filter(([, list]) => list.length);

  return (
    <div className="space-y-3">
      <label htmlFor={selectId} className="block text-sm text-neutral-600">
        {current ? "Change clinician" : "Allocate a clinician"}
      </label>
      <select
        id={selectId}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        disabled={!clinicians || pending}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm disabled:bg-neutral-50"
      >
        <option value="">{clinicians ? "Choose a clinician…" : "Loading…"}</option>
        {byProfession.map(([profession, list]) => (
          <optgroup key={profession} label={PROFESSION_LABELS[profession]}>
            {list.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.hasAvailability}>
                {c.name}
                {c.suburb ? ` · ${c.suburb}` : ""}
                {c.hasAvailability ? ` · ${c.capacity > 0 ? `${c.capacity} place${c.capacity === 1 ? "" : "s"} free` : "full"}` : " · no available times yet"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {clinicians?.length === 0 && <p className="text-sm text-neutral-500">No active clinicians yet.</p>}
      {error && (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!choice || choice === current?.id || pending}
          className="rounded-md bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Saving emails the family a link to book an intro call in {current ? "the new" : "the"} clinician&apos;s available times, and tells the clinician to expect them
        {current ? `. ${current.name} is told the client has moved.` : "."}
      </p>
    </div>
  );
}
