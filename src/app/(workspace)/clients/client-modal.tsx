"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "@/components/workspace/modal";
import { CLIENT_STATUS_LABELS, FUNDING_SHORT, childFullName, formatElapsed, type ClientRow } from "@/lib/client-summary";
import {
  CONCERN_LABELS,
  FUNDING_LABELS,
  INTEREST_LABELS,
  MATCH_STATE_LABELS,
  SERVICE_LABELS,
  TIME_BLOCK_LABELS,
  type Concern,
  type FamilyStatus,
  type TimeBlock,
} from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import { ageFrom, formatDate, formatDateTime } from "@/lib/time";
import { getClientDetail, type ClientDetail } from "./actions";
import { StatusPill } from "./client-table";

const CONSENT_LABELS: Record<string, string> = {
  privacy_collection: "Privacy collection notice",
  contact: "Contact about services",
  share_with_clinician: "Share details with the matched clinician",
};

type Loaded = { id: string; detail: ClientDetail } | { id: string; error: string };

export function ClientModal({ row, onClose }: { row: ClientRow | null; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    getClientDetail(row.id)
      .then((r) => !cancelled && setLoaded(r.ok ? { id: row.id, detail: r.detail } : { id: row.id, error: r.error }))
      .catch(() => !cancelled && setLoaded({ id: row.id, error: "Couldn't load this client. Try again." }));
    return () => {
      cancelled = true;
    };
  }, [row]);

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
            <p className="text-sm text-neutral-500">Change status, run matching and record outcomes from the full record.</p>
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
        <Detail detail={current.detail} />
      )}
    </Modal>
  );
}

function Detail({ detail }: { detail: ClientDetail }) {
  const { family, children, consents, intake, matches, history } = detail;
  return (
    <div className="space-y-8">
      <Section title="Contact">
        <Facts
          items={[
            ["Parent or carer", family.parent_name],
            ["Email", <a key="e" href={`mailto:${family.email}`} className="underline underline-offset-4">{family.email}</a>],
            ["Mobile", <a key="m" href={`tel:${family.mobile}`} className="underline underline-offset-4">{formatAuMobile(family.mobile)}</a>],
            ["Location", `${family.suburb} ${family.postcode}${family.state ? `, ${family.state}` : ""}`],
            ["Funding", FUNDING_LABELS[family.funding_type]],
            ["Plan manager", family.plan_manager],
            ["Heard about us", family.referral_source],
            ["Signed up", formatDateTime(family.created_at)],
            ["Coordinator", family.assigned_name],
            ["Complex case", family.complex_case ? "Yes: a clinical lead approves the match" : "No"],
          ]}
        />
      </Section>

      <Section title="Status">
        <Facts
          items={[
            ["Current step", CLIENT_STATUS_LABELS[family.status]],
            ["Since", formatDateTime(family.status_changed_at)],
            ["Reason", family.status_reason],
            ["Waitlist reason", family.waitlist_reason],
          ]}
        />
      </Section>

      {children.map((c) => (
        <Section key={c.id} title={`Child: ${childFullName(c)}`}>
          <Facts
            items={[
              ["Age", ageFrom(c.dob, c.age_years)?.toString() ?? null],
              ["Date of birth", c.dob ? formatDate(c.dob) : null],
              ["Service", SERVICE_LABELS[c.service_type]],
              ["Concerns", [...c.concerns.map((x) => CONCERN_LABELS[x as Concern] ?? x), c.concern_other].filter(Boolean).join(", ") || null],
              ["Preferred times", c.preferred_times.map((t) => TIME_BLOCK_LABELS[t as TimeBlock]).join(", ") || null],
              ["Language at home", c.language],
              ["Clinician gender", c.gender_preference ? `Prefers ${c.gender_preference}` : null],
              ["Telehealth", c.telehealth_ok ? "Open to telehealth" : "In person"],
              ["Special interests", c.interests_needed.map((i) => INTEREST_LABELS[i] ?? i).join(", ") || null],
              ["Intake notes", c.notes_intake],
            ]}
          />
        </Section>
      ))}

      <Section title="Clinician offers">
        {!matches.length ? (
          <Empty>No offers sent yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {matches.map((m) => (
              <li key={m.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium text-neutral-900">{m.clinician ?? "Clinician"}</p>
                  <p className="text-neutral-500">
                    Offered {formatDateTime(m.offered_at)}
                    {m.distance_km !== null && ` · ${m.distance_km} km away`}
                    {m.response_reason && ` · “${m.response_reason}”`}
                  </p>
                  {(m.intro_at || m.intro_outcome) && (
                    <p className="text-neutral-500">
                      Intro call {m.intro_at ? formatDateTime(m.intro_at) : ""}
                      {m.intro_outcome && ` · ${m.intro_outcome.replaceAll("_", " ")}`}
                    </p>
                  )}
                  {m.first_session_at && <p className="text-emerald-800">First session {formatDate(m.first_session_at)}</p>}
                </div>
                <span className="text-neutral-600">{MATCH_STATE_LABELS[m.state] ?? m.state}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Intake calls">
        {!intake.length ? (
          <Empty>No intake call yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {intake.map((i, n) => (
              <li key={n} className="py-3 text-sm">
                <p className="text-neutral-900">
                  {i.completed_at ? `Done ${formatDateTime(i.completed_at)}` : i.scheduled_at ? `Booked for ${formatDateTime(i.scheduled_at)}` : "Not booked"}
                  {i.outcome && ` · ${i.outcome.replaceAll("_", " ")}`}
                </p>
                {i.outcome_reason && <p className="text-neutral-500">{i.outcome_reason}</p>}
                {i.notes && <p className="mt-1 whitespace-pre-line text-neutral-600">{i.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Consent">
        {!consents.length ? (
          <Empty>No consent recorded.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {consents.map((c) => (
              <li key={c.type} className="flex flex-wrap justify-between gap-2">
                <span>{CONSENT_LABELS[c.type] ?? c.type}</span>
                <span className={c.withdrawn_at ? "text-red-800" : "text-neutral-500"}>
                  {c.withdrawn_at ? `Withdrawn ${formatDate(c.withdrawn_at)}` : `Given ${formatDate(c.granted_at)} (v${c.version})`}
                </span>
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
                <p className="text-neutral-900">
                  {h.from_status ? `${CLIENT_STATUS_LABELS[h.from_status as FamilyStatus] ?? h.from_status} → ` : ""}
                  {CLIENT_STATUS_LABELS[h.to_status as FamilyStatus] ?? h.to_status}
                </p>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-neutral-500">{k}</dt>
          <dd className="text-neutral-900">{v ?? <span className="text-neutral-400">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}
