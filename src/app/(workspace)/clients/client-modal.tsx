"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/workspace/modal";
import { TabBar } from "@/components/workspace/tabs";
import { FUNDING_SHORT, formatElapsed, type ClientRow } from "@/lib/client-summary";
import { getClientDetail, type ClientDetail } from "./actions";
import { CLIENT_TABS, ClientBookings, ClientHistory, ClientInfo } from "./client-detail";
import { StatusPill } from "./client-table";

type Loaded = { id: string; detail: ClientDetail } | { id: string; error: string };

export function ClientModal({ row, onClose }: { row: ClientRow | null; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    getClientDetail(row.id)
      .then((r) => !cancelled && setLoaded(r.ok ? { id: row.id, detail: r.detail } : { id: row.id, error: r.error }))
      .catch(() => !cancelled && setLoaded({ id: row.id, error: "Couldn't load this client. Try again." }));
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
            <span>Parent: {row.parentName} ·</span>
            <StatusPill status={row.status} />
            {row.elapsedHours !== null && (
              <span className={row.overdue ? "text-red-800" : undefined}>
                {formatElapsed(row.elapsedHours)} in this step{row.targetHours !== null && ` (target ${row.targetHours}h)`}
              </span>
            )}
            <span>
              · {row.suburb}
              {row.state && `, ${row.state}`} · {FUNDING_SHORT[row.funding]}
            </span>
          </span>
        )
      }
      footer={
        row && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">Change status and record outcomes from the full record.</p>
            <Link href={`/families/${row.id}`} className="inline-flex min-h-10 items-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800">
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
        <Detail detail={current.detail} onChanged={() => setVersion((v) => v + 1)} />
      )}
    </Modal>
  );
}

function Detail({ detail, onChanged }: { detail: ClientDetail; onChanged: () => void }) {
  const [tab, setTab] = useState("info");
  return (
    <div className="space-y-6">
      <TabBar tabs={CLIENT_TABS} active={tab} onChange={setTab} label="Client record" />
      {tab === "info" && <ClientInfo detail={detail} onChanged={onChanged} />}
      {tab === "bookings" && <ClientBookings detail={detail} />}
      {tab === "history" && <ClientHistory detail={detail} />}
    </div>
  );
}
