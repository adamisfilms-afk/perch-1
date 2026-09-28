"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { allocateClinician, listAllocatableClinicians, type AllocatableClinician } from "@/app/(workspace)/clients/actions";
import { PROFESSION_LABELS, PROFESSIONS } from "@/lib/domain";
import { formatDateTime } from "@/lib/time";

/**
 * Shows who a client is allocated to (or who they've been offered to), with "Allocate clinician" (or "Edit") to pick
 * from the active clinicians. Saving offers the client to that clinician: they accept or decline from our email.
 * When they accept, the family is emailed their intro-call booking link and the clinician the family's details.
 */
export function AllocateClinician({
  familyId,
  current,
  pending = null,
  blockedReason,
  onAllocated,
}: {
  familyId: string;
  current: { id: string; name: string } | null;
  /** An offer waiting for the clinician's answer. */
  pending?: { id: string; name: string; expiresAt: string | null } | null;
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
  const [saving, startTransition] = useTransition();

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
    setChoice(current?.id ?? pending?.id ?? "");
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
            ) : pending ? (
              <span>
                <span className="text-neutral-900">Offered to {pending.name}</span>
                <span className="block text-neutral-500">
                  Waiting for their answer{pending.expiresAt ? ` (closes ${formatDateTime(pending.expiresAt)})` : ""}
                </span>
              </span>
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
              {current || pending ? "Edit" : "Allocate clinician"}
            </button>
          )}
        </div>
        {blockedReason && <p className="text-sm text-neutral-500">{blockedReason}</p>}
        {saved && (
          <p className="text-sm text-emerald-800" role="status">
            Sent. The clinician has been emailed the referral to accept or decline. Once they accept, the family gets their intro-call booking link.
          </p>
        )}
      </div>
    );
  }

  const byProfession = PROFESSIONS.map((p) => [p, (clinicians ?? []).filter((c) => c.profession === p)] as const).filter(([, list]) => list.length);

  return (
    <div className="space-y-3">
      <label htmlFor={selectId} className="block text-sm text-neutral-600">
        {current || pending ? "Change clinician" : "Allocate a clinician"}
      </label>
      <select
        id={selectId}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        disabled={!clinicians || saving}
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
          disabled={!choice || choice === current?.id || choice === pending?.id || saving}
          className="rounded-md bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {saving ? "Sending…" : "Save and send offer"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Saving emails the clinician a summary (no names) to accept or decline. When they accept, the family is emailed a link to book an intro call
        in their available times, and the clinician gets the family&apos;s details.
        {current ? ` ${current.name} is told the client has moved.` : pending ? ` ${pending.name}'s offer is withdrawn.` : ""}
      </p>
    </div>
  );
}
