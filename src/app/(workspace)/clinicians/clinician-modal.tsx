"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/workspace/modal";
import { TabBar } from "@/components/workspace/tabs";
import { formatElapsed } from "@/lib/client-summary";
import { ONBOARDING_STAGES, type ClinicianSummaryRow } from "@/lib/clinician-summary";
import { PROFESSION_LABELS } from "@/lib/domain";
import { getClinicianDetail, type ClinicianDetail } from "./actions";
import { ClinicianBookings, ClinicianDocuments, ClinicianHistory, ClinicianInfo, clinicianTabs } from "./clinician-detail";
import { StagePill } from "./clinician-table";

type Loaded = { id: string; detail: ClinicianDetail } | { id: string; error: string };

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
  const [tab, setTab] = useState("info");
  return (
    <div className="space-y-6">
      <TabBar tabs={clinicianTabs(detail)} active={tab} onChange={setTab} label="Clinician record" />
      {tab === "info" && <ClinicianInfo detail={detail} onboarding={onboarding} canRecordIntake={canRecordIntake} onChanged={onChanged} />}
      {tab === "documents" && <ClinicianDocuments detail={detail} />}
      {tab === "bookings" && <ClinicianBookings detail={detail} />}
      {tab === "history" && <ClinicianHistory detail={detail} />}
    </div>
  );
}
