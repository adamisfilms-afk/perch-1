import Link from "next/link";
import { ClinicianStatusBadge } from "@/components/display";
import { Badge, Card, EmptyState, PageHeader, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CLINICIAN_STATUS_LABELS, PROFESSION_LABELS, type ClinicianStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import type { ClinicianRow } from "@/lib/types";

export const metadata = { title: "Clinicians" };

const RECRUITING: ClinicianStatus[] = ["applied", "screening", "documents_requested", "documents_verified", "agreement_signed", "onboarding", "orientation"];

export default async function CliniciansPage({ searchParams }: PageProps<"/clinicians">) {
  await requireStaff();
  const { view } = await searchParams;
  const tab = view === "recruiting" || view === "offboarded" ? view : "network";
  const supabase = await createClient();
  const { data } = await supabase.from("clinicians").select("*").order("name");
  const all = (data ?? []) as ClinicianRow[];
  const count = (s: ClinicianStatus[]) => all.filter((c) => s.includes(c.status)).length;
  const shown = all.filter((c) =>
    tab === "recruiting" ? RECRUITING.includes(c.status) : tab === "offboarded" ? c.status === "offboarded" : ["active", "paused"].includes(c.status),
  );

  return (
    <div>
      <PageHeader title="Clinicians" description="The network, and everyone on the way in." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[
          ["network", `Network (${count(["active", "paused"])})`],
          ["recruiting", `Recruitment (${count(RECRUITING)})`],
          ["offboarded", `Off-boarded (${count(["offboarded"])})`],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/clinicians?view=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1", tab === key ? "border-brand-600 bg-brand-50 text-brand-800" : "border-stone-300 bg-white")}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "recruiting" && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-stone-600">
          {RECRUITING.map((s) => (
            <span key={s}>
              {CLINICIAN_STATUS_LABELS[s]}: <strong>{count([s])}</strong>
            </span>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState>Nobody here yet.</EmptyState>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {shown.map((c) => (
              <li key={c.id}>
                <Link href={`/clinicians/${c.id}`} className="flex flex-col gap-1 p-3 text-sm hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{c.name}</span>{" "}
                    <span className="text-stone-500">
                      · {PROFESSION_LABELS[c.profession]} · {c.suburb ?? "no base"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {c.status === "active" && (
                      <Badge tone={c.capacity_new > 0 ? "green" : "neutral"}>
                        {c.snoozed_until ? `snoozed to ${c.snoozed_until}` : `${c.capacity_new} spaces`}
                      </Badge>
                    )}
                    {c.ndis_registered && <Badge tone="blue">NDIS registered</Badge>}
                    <ClinicianStatusBadge status={c.status} pauseReason={c.pause_reason} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
