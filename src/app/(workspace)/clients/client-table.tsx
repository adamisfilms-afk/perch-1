"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { ArrowRightIcon, ChevronIcon, SearchIcon } from "@/components/workspace/icons";
import {
  CLIENT_STATUS_LABELS,
  FUNDING_SHORT,
  filterClients,
  formatElapsed,
  formatSignUpDate,
  sortClients,
  type ClientRow,
  type SortDir,
  type SortKey,
} from "@/lib/client-summary";
import type { FamilyStatus } from "@/lib/domain";
import { ClientModal } from "./client-modal";

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "name", label: "Client", className: "pl-4 md:pl-16 w-[26%]" },
  { key: "status", label: "Status", className: "w-[17%]" },
  { key: "elapsed", label: "Elapsed" },
  { key: "signup", label: "Sign up date" },
  { key: "session", label: "Session hrs" },
  { key: "location", label: "Location" },
  { key: "funding", label: "Funding" },
  { key: null, label: "Action", className: "pr-4 md:pr-8" },
];

/** First click on a column: A→Z for words, newest/longest first for dates and times. */
const FIRST_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  status: "asc",
  elapsed: "desc",
  signup: "desc",
  session: "desc",
  location: "asc",
  funding: "asc",
};

export function ClientTable({ rows }: { rows: ClientRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = useMemo(() => sortClients(filterClients(rows, q), sort.key, sort.dir), [rows, q, sort]);
  const open = rows.find((r) => r.id === openId) ?? null;

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIR[key] }));

  return (
    <section aria-label="Clients" className="flex-1">
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 md:px-8">
        <SearchIcon className="size-5 shrink-0 text-neutral-500" />
        <label htmlFor="client-search" className="sr-only">
          Search clients
        </label>
        <input
          id="client-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="min-h-13 w-full bg-transparent py-3 text-[17px] placeholder:text-neutral-500 focus:outline-none"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-left text-[16px]">
          <caption className="sr-only">Clients, sorted by {COLUMNS.find((c) => c.key === sort.key)?.label.toLowerCase()}. Select a name to see their details.</caption>
          <thead>
            <tr className="border-b border-neutral-200">
              {COLUMNS.map((c) => {
                const active = c.key !== null && c.key === sort.key;
                return (
                  <th
                    key={c.label}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("py-4 pr-4 text-[15px] font-normal uppercase tracking-wide", c.className)}
                  >
                    {c.key ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key as SortKey)}
                        className={cn("inline-flex items-center gap-1.5 uppercase tracking-wide", active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700")}
                      >
                        {c.label}
                        <ChevronIcon className={cn("size-4 transition-transform", active ? "opacity-100" : "opacity-0", active && sort.dir === "desc" && "rotate-180")} />
                      </button>
                    ) : (
                      <span className="text-neutral-400">{c.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="group text-neutral-600 hover:bg-neutral-50">
                <td className="py-3.5 pl-4 pr-4 md:pl-16">
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    title={`Parent or carer: ${r.parentName}`}
                    className="text-left text-neutral-700 decoration-neutral-400 underline-offset-4 hover:text-neutral-900 hover:underline focus-visible:underline"
                  >
                    {r.name}
                  </button>
                  <span className="sr-only">, parent {r.parentName}</span>
                </td>
                <td className="py-3.5 pr-4">
                  <StatusPill status={r.status} />
                </td>
                <td className="py-3.5 pr-4 tabular-nums">
                  {r.elapsedHours === null ? (
                    <span className="text-neutral-400">–</span>
                  ) : (
                    <span
                      className={r.overdue ? "text-red-800" : undefined}
                      title={r.targetHours !== null ? `Target ${r.targetHours}h for this step` : "No target set for this step"}
                    >
                      {r.overdue && (
                        <>
                          <span aria-hidden>! </span>
                          <span className="sr-only">Over target: </span>
                        </>
                      )}
                      {formatElapsed(r.elapsedHours)}
                    </span>
                  )}
                </td>
                <td className="py-3.5 pr-4 tabular-nums">{formatSignUpDate(r.createdAt)}</td>
                <td className="py-3.5 pr-4 tabular-nums">{r.sessionHours ?? ""}</td>
                <td className="py-3.5 pr-4" title={r.suburb}>
                  {r.state ?? "–"}
                </td>
                <td className="py-3.5 pr-4 uppercase">{FUNDING_SHORT[r.funding]}</td>
                <td className="py-3.5 pr-4 md:pr-8">
                  <Link
                    href={`/families/${r.id}`}
                    className="inline-flex items-center gap-1 rounded text-sm text-neutral-400 opacity-60 hover:text-neutral-900 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    Open <ArrowRightIcon className="size-3.5" />
                    <span className="sr-only">{r.name}&apos;s full record</span>
                  </Link>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-16 text-center text-neutral-500 md:px-16">
                  {q ? `No clients match “${q}”.` : "No clients yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ClientModal row={open} onClose={() => setOpenId(null)} />
    </section>
  );
}

export function StatusPill({ status }: { status: FamilyStatus }) {
  const tone =
    status === "converted"
      ? "bg-emerald-100 text-emerald-950"
      : status === "waitlist"
        ? "bg-amber-100 text-amber-950"
        : ["lost", "not_suitable", "withdrawn"].includes(status)
          ? "bg-neutral-100 text-neutral-500"
          : "bg-neutral-200/70 text-neutral-800";
  return <span className={cn("inline-block whitespace-nowrap rounded px-2 py-1 text-sm leading-none", tone)}>{CLIENT_STATUS_LABELS[status]}</span>;
}
