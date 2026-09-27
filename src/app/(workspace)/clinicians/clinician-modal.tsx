"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { completeIntake } from "@/app/(staff)/clinicians/[id]/actions";
import type { ActionState } from "@/components/forms";
import { Empty, Facts, Section } from "@/components/workspace/detail-parts";
import { Modal } from "@/components/workspace/modal";
import { CLIENT_STATUS_LABELS, formatElapsed } from "@/lib/client-summary";
import { ONBOARDING_STAGES, type ClinicianSummaryRow } from "@/lib/clinician-summary";
import {
  AGE_GROUP_LABELS,
  CLINICIAN_STATUS_LABELS,
  CREDENTIALS,
  FUNDING_LABELS,
  PROFESSION_LABELS,
  applicationGapLabel,
  goLiveGapLabel,
  requiredCredentialTypes,
  type AgeGroup,
} from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import { formatDate, formatDateTime } from "@/lib/time";
import { getClinicianDetail, type ClinicianDetail } from "./actions";
import { StagePill } from "./clinician-table";

type Loaded = { id: string; detail: ClinicianDetail } | { id: string; error: string };

const DOC_STATUS: Record<string, string> = { pending: "Uploaded, to check", verified: "Verified", expired: "Expired", rejected: "Rejected" };

export function ClinicianModal({ row, canRecordIntake, onClose }: { row: ClinicianSummaryRow | null; canRecordIntake: boolean; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    getClinicianDetail(row.id)
      .then((r) => !cancelled && setLoaded(r.ok ? { id: row.id, detail: r.detail } : { id: row.id, error: r.error }))
      .catch(() => !cancelled && setLoaded({ id: row.id, error: "Couldn't load this clinician. Try again." }));
    return () => {
      cancelled = true;
    };
  }, [row, version]);

  const current = row && loaded?.id === row.id ? loaded : null;

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      className="max-w-3xl"
      title={row?.name}
      subtitle={
        row && (
          <span className="flex flex-wrap items-center gap-2">
            <span>{PROFESSION_LABELS[row.profession]} ·</span>
            <StagePill stage={row.stage} />
            {row.elapsedHours !== null && (
              <span className={row.overdue ? "text-red-800" : undefined}>
                {formatElapsed(row.elapsedHours)} in this step{row.targetHours !== null && ` (target ${row.targetHours}h)`}
              </span>
            )}
            {(row.suburb || row.state) && <span>· {[row.suburb, row.state].filter(Boolean).join(", ")}</span>}
          </span>
        )
      }
      footer={
        row && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">Verify documents, edit the profile and change status from the full record.</p>
            <Link href={`/clinicians/${row.id}`} className="inline-flex min-h-10 items-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800">
              Open full record
            </Link>
          </div>
        )
      }
    >
      {!current ? (
        <p className="py-10 text-center text-neutral-500" role="status">
          Loading…
        </p>
      ) : "error" in current ? (
        <p className="py-10 text-center text-red-800" role="alert">
          {current.error}
        </p>
      ) : (
        <Detail detail={current.detail} onboarding={!!row && ONBOARDING_STAGES.includes(row.stage)} canRecordIntake={canRecordIntake} onChanged={() => setVersion((v) => v + 1)} />
      )}
    </Modal>
  );
}

function Detail({ detail, onboarding, canRecordIntake, onChanged }: { detail: ClinicianDetail; onboarding: boolean; canRecordIntake: boolean; onChanged: () => void }) {
  const { clinician: c, documents, applicationGaps, goLiveGaps, clients, history } = detail;
  const screeningAt = typeof c.application.screening_at === "string" ? c.application.screening_at : null;
  const required = requiredCredentialTypes(c.profession, c.home_visits);
  const doc = (t: string) => documents.find((d) => d.type === t);

  return (
    <div className="space-y-8">
      {onboarding && (
        <Section title="Onboarding">
          <Facts
            items={[
              ["Signed up", formatDateTime(c.created_at)],
              ["Application", c.application_submitted_at ? `Submitted ${formatDateTime(c.application_submitted_at)}` : "Not submitted yet"],
              ["Intake call", screeningAt ? `Booked for ${formatDateTime(screeningAt)}` : c.application_submitted_at ? "Not booked yet" : null],
              ["Portal", c.user_id ? "Invited" : "Not invited"],
            ]}
          />
          {!c.application_submitted_at && applicationGaps.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="text-neutral-500">Still to do in the portal</p>
              <ul className="mt-1 list-disc pl-5 text-neutral-900">
                {applicationGaps.map((g) => (
                  <li key={g}>{applicationGapLabel(g)}</li>
                ))}
              </ul>
            </div>
          )}
          {c.application_submitted_at && (
            <div className="mt-4 space-y-3 text-sm">
              {goLiveGaps.filter((g) => g !== "clinical_lead_approval").length > 0 ? (
                <div>
                  <p className="text-neutral-500">Before they can go live</p>
                  <ul className="mt-1 list-disc pl-5 text-neutral-900">
                    {goLiveGaps
                      .filter((g) => g !== "clinical_lead_approval")
                      .map((g) => (
                        <li key={g}>{goLiveGapLabel(g)}</li>
                      ))}
                  </ul>
                </div>
              ) : (
                <p className="text-emerald-800">Documents verified: ready for the intake call to be recorded.</p>
              )}
              {canRecordIntake ? (
                <IntakeForm clinicianId={c.id} onDone={onChanged} />
              ) : (
                <p className="text-neutral-500">A clinical lead or admin records the intake call, which makes them ready for clients.</p>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Contact">
        <Facts
          items={[
            ["Email", <a key="e" href={`mailto:${c.email}`} className="underline underline-offset-4">{c.email}</a>],
            ["Mobile", c.mobile ? <a key="m" href={`tel:${c.mobile}`} className="underline underline-offset-4">{formatAuMobile(c.mobile)}</a> : null],
            ["Location", [c.suburb, c.postcode].filter(Boolean).join(" ") || null],
            ["Status in the system", CLINICIAN_STATUS_LABELS[c.status]],
          ]}
        />
      </Section>

      <Section title="Profile">
        <Facts
          items={[
            ["Ages", c.age_groups.map((a) => AGE_GROUP_LABELS[a as AgeGroup] ?? a).join(", ") || null],
            ["Funding", c.funding_types.map((f) => FUNDING_LABELS[f]).join(", ") || null],
            ["Capacity", `${c.capacity_new} new ${c.capacity_new === 1 ? "client" : "clients"}`],
            ["Intro-call link", c.calcom_intro_url ? <a key="i" href={c.calcom_intro_url} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4">{c.calcom_intro_url}</a> : null],
          ]}
        />
      </Section>

      <Section title="Documents">
        <ul className="space-y-1 text-sm">
          {required.map((t) => {
            const d = doc(t);
            return (
              <li key={t} className="flex flex-wrap justify-between gap-2">
                <span>{CREDENTIALS[t].label}</span>
                <span className={!d || d.status === "rejected" || d.status === "expired" ? "text-red-800" : d.status === "verified" ? "text-neutral-500" : "text-amber-800"}>
                  {d ? DOC_STATUS[d.status] : "Not uploaded"}
                  {d?.status === "verified" && d.expires_at && ` · expires ${formatDate(d.expires_at)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Clients">
        {!clients.length ? (
          <Empty>No clients allocated yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {clients.map((cl) => (
              <li key={cl.family_id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/families/${cl.family_id}`} className="text-neutral-900 underline-offset-4 hover:underline">
                  {cl.name}
                </Link>
                <span className="text-neutral-500">{CLIENT_STATUS_LABELS[cl.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="History">
        {!history.length ? (
          <Empty>No changes yet.</Empty>
        ) : (
          <ol className="space-y-2 border-l border-neutral-200 pl-4 text-sm">
            {history.map((h, n) => (
              <li key={n}>
                <p className="text-neutral-900">{h.to_status.replaceAll("_", " ")}</p>
                <p className="text-neutral-500">
                  {formatDateTime(h.at)}
                  {h.by && ` · ${h.by}`}
                  {h.reason && ` · ${h.reason}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function IntakeForm({ clinicianId, onDone }: { clinicianId: string; onDone: () => void }) {
  const router = useRouter();
  const notesId = useId();
  const [state, action] = useActionState<ActionState, FormData>(completeIntake.bind(null, clinicianId), {});
  // Each result is handled once, even though onDone is a new function on every render.
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
    onDone();
  }, [state, router, onDone]);
  return (
    <form action={action} className="space-y-3 rounded-md border border-neutral-200 p-3" noValidate>
      <label htmlFor={notesId} className="block text-neutral-600">
        Intake call notes
      </label>
      <textarea id={notesId} name="notes" maxLength={4000} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      {state.error && (
        <p className="text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <RecordButton />
    </form>
  );
}

function RecordButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40">
      {pending ? "Saving…" : "Save/Complete intake call"}
    </button>
  );
}
