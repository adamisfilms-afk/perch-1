import Link from "next/link";
import { SimpleActionButton } from "@/components/forms";
import { FirstSessionForm, IntroOutcomeForm } from "@/components/referral-forms";
import { notFound } from "next/navigation";
import { DateOnly, FamilyStatusBadge, MatchStateBadge, When } from "@/components/display";
import { Alert, Badge, Card, CardTitle, DefinitionList, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  CONCERN_LABELS,
  FAMILY_STATUS_LABELS,
  FAMILY_TRANSITIONS,
  FUNDING_LABELS,
  MANUAL_FAMILY_STATUSES,
  SERVICE_LABELS,
  TIME_BLOCK_LABELS,
  type Concern,
} from "@/lib/domain";
import { FILTER_LABELS, runMatching } from "@/lib/matching";
import { formatAuMobile } from "@/lib/phone";
import { loadMatchClinicians, toMatchChild, toMatchFamily } from "@/lib/server/matching-data";
import { createClient } from "@/lib/supabase/server";
import { ageFrom, relativeHours, hoursSince, todayInAustralia } from "@/lib/time";
import { firstOf, type ChildRow, type FamilyRow, type MatchRow, type StatusHistoryRow } from "@/lib/types";
import * as actions from "./actions";
import {
  ChildForm,
  FamilyDetailsForm,
  IntakeForm,
  ShortlistForm,
  StatusForm,
  WithdrawForm,
} from "./family-forms";

export const metadata = { title: "Family" };

type MatchWithClinician = MatchRow & { clinicians: { name: string } | null; intro_calls: { scheduled_at: string | null; outcome: string | null }[]; conversions: { first_session_at: string } | { first_session_at: string }[] | null };

const NOTICES: Record<string, string> = {
  intake_ready_to_match: "Intake saved. The family is ready to match: pick a shortlist below.",
  intake_needs_follow_up: "Intake saved. The family is back in Contacted for follow-up.",
  intake_not_suitable: "Intake saved. The family has been sent the signposting message.",
  shortlist: "Shortlist saved. Approve it to send the first offer.",
  shortlist_complex: "Shortlist saved. A clinical lead needs to approve it.",
  approved: "Approved. The first offer has been sent.",
  waitlist: "Moved to the waitlist. You'll be alerted when capacity frees up.",
  withdrawn: "Offer withdrawn. The next clinician on the shortlist (if any) has been offered.",
  intro: "Intro call outcome saved.",
  converted: "First session confirmed. The family is converted 🎉",
  status: "Status updated.",
};

export default async function FamilyPage({ params, searchParams }: PageProps<"/families/[id]">) {
  const viewer = await requireStaff();
  const { id } = await params;
  const { notice } = await searchParams;
  const supabase = await createClient();

  const { data: family } = await supabase.from("families").select("*").eq("id", id).maybeSingle<FamilyRow>();
  if (!family) notFound();
  await supabase.rpc("log_access", { p_entity_type: "families", p_entity_id: id, p_action: "view" });

  const [{ data: childRows }, { data: intake }, { data: matchRows }, { data: history }, { data: messages }, { data: people }, { data: consents }] =
    await Promise.all([
      supabase.from("children").select("*").eq("family_id", id).order("created_at"),
      supabase.from("intake_calls").select("*").eq("family_id", id).order("created_at", { ascending: false }),
      supabase
        .from("matches")
        .select("*, clinicians(name), intro_calls(scheduled_at, outcome), conversions(first_session_at)")
        .eq("family_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("status_history").select("*").eq("entity_type", "family").eq("entity_id", id).order("at", { ascending: false }),
      supabase
        .from("message_log")
        .select("id, template, channel, status, scheduled_for, sent_at, last_error")
        .eq("recipient_kind", "family")
        .eq("recipient_id", id)
        .order("scheduled_for", { ascending: false })
        .limit(30),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("consents").select("type, version, granted_at, withdrawn_at").eq("family_id", id),
    ]);

  const children = (childRows ?? []) as ChildRow[];
  const child = children[0];
  const matches = (matchRows ?? []) as unknown as MatchWithClinician[];
  const names = new Map((people ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  const today = todayInAustralia();
  const hours = hoursSince(family.status_changed_at);

  const inIntake = ["new", "contacted", "intake_booked", "intake_done"].includes(family.status);
  const canMatch = ["ready_to_match", "waitlist"].includes(family.status);
  const proposed = matches.filter((m) => m.state === "proposed" && child && m.child_id === child.id);
  const offered = matches.filter((m) => m.state === "offered");
  const accepted = matches.find((m) => m.state === "accepted");
  const manualOptions = MANUAL_FAMILY_STATUSES.filter((s) => FAMILY_TRANSITIONS[family.status].includes(s) || viewer.role === "admin").filter(
    (s) => s !== family.status,
  );
  const lastIntake = intake?.find((i: { completed_at: string | null }) => i.completed_at) as { answers: Record<string, string | null>; notes: string | null } | undefined;
  const nextIntake = intake?.find((i: { completed_at: string | null; scheduled_at: string | null }) => !i.completed_at && i.scheduled_at) as
    | { scheduled_at: string }
    | undefined;

  let matching: ReturnType<typeof runMatching> | null = null;
  if (child && canMatch && proposed.length === 0) {
    matching = runMatching(toMatchChild(child), toMatchFamily(family), await loadMatchClinicians(supabase), { today, suburb: family.suburb });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {children.map((c) => c.first_name).join(" & ")} <span className="font-normal text-stone-500">· {family.parent_name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <FamilyStatusBadge status={family.status} />
            <span>
              for {relativeHours(hours)}
              {family.status_reason && ` · ${family.status_reason}`}
            </span>
            {family.complex_case && <Badge tone="violet">Complex case</Badge>}
          </span>
        }
        actions={<Link href="/families" className="text-sm text-brand-700 underline">← All families</Link>}
      />

      {typeof notice === "string" && NOTICES[notice] && <Alert tone="green">{NOTICES[notice]}</Alert>}
      {family.lat === null && <Alert>This suburb isn&apos;t on the map yet, so matching can only use clinicians&apos; suburb lists. Check the suburb and postcode below.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {inIntake && child && (
            <Card>
              <CardTitle>Intake call</CardTitle>
              {nextIntake && (
                <p className="mb-3 text-sm">
                  Booked for <When at={nextIntake.scheduled_at} uk={viewer.showUkTime} />
                </p>
              )}
              <IntakeForm action={actions.completeIntake.bind(null, family.id, child.id)} family={family} child={child} previous={lastIntake?.answers ?? null} />
            </Card>
          )}

          {child && (canMatch || proposed.length > 0 || offered.length > 0) && (
            <Card>
              <CardTitle>Matching</CardTitle>
              {proposed.length > 0 && offered.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-stone-700">
                    Shortlist waiting for approval. Offers go out {proposed.length > 1 ? "in this order" : "to this clinician"}; declines and
                    timeouts move to the next automatically.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {proposed
                      .sort((a, b) => a.rank - b.rank)
                      .map((m) => (
                        <li key={m.id}>
                          {m.clinicians?.name} · score {m.rule_score} · {m.distance_km ?? "?"} km {m.approved_at && <Badge tone="green">approved</Badge>}
                        </li>
                      ))}
                  </ol>
                  {family.complex_case && viewer.role === "coordinator" ? (
                    <Alert tone="blue">Complex case: a clinical lead needs to approve this shortlist.</Alert>
                  ) : (
                    <SimpleActionButton action={actions.approveShortlist.bind(null, family.id, child.id)} label="Approve and send the first offer" />
                  )}
                </div>
              )}
              {offered.length > 0 && (
                <ul className="space-y-3">
                  {offered.map((m) => (
                    <li key={m.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                      <p>
                        Offered to <strong>{m.clinicians?.name}</strong>, closes <When at={m.offer_expires_at} uk={viewer.showUkTime} />
                      </p>
                      <div className="mt-2">
                        <WithdrawForm action={actions.withdrawOffer.bind(null, family.id, m.id)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {matching && (
                <div className="space-y-4">
                  {matching.warnings.map((w) => (
                    <Alert key={w}>{w}</Alert>
                  ))}
                  {matching.shortlist.length > 0 ? (
                    <>
                      <p className="text-sm text-stone-700">
                        These clinicians pass every rule, best first. Tick who should be on the shortlist. A person approves before anything is sent.
                      </p>
                      <ShortlistForm
                        action={actions.proposeShortlist.bind(null, family.id, child.id)}
                        options={matching.shortlist.map((c) => ({
                          id: c.clinician.id,
                          name: c.clinician.name,
                          score: c.score,
                          distance: c.distance_km === null ? "distance n/a" : `${c.distance_km.toFixed(1)} km`,
                          notes: c.notes,
                          breakdown: c.breakdown as unknown as Record<string, number>,
                        }))}
                      />
                    </>
                  ) : (
                    <div className="space-y-3">
                      <Alert tone="amber">{matching.waitlist?.reason ?? "Nobody passes the matching rules."}</Alert>
                      {family.status !== "waitlist" && (
                        <SimpleActionButton action={actions.moveToWaitlist.bind(null, family.id, child.id)} label="Move to waitlist" variant="secondary" />
                      )}
                    </div>
                  )}
                  {matching.rejected.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-brand-700">Why others were ruled out ({matching.rejected.length})</summary>
                      <ul className="mt-2 space-y-1">
                        {matching.rejected
                          .sort((a, b) => a.failed.length - b.failed.length)
                          .slice(0, 30)
                          .map((r) => (
                            <li key={r.clinician.id}>
                              <Link href={`/clinicians/${r.clinician.id}`} className="underline">
                                {r.clinician.name}
                              </Link>
                              : {r.failed.map((f) => FILTER_LABELS[f]).join(", ")}
                              {r.distance_km !== null && ` (${r.distance_km.toFixed(1)} km)`}
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </Card>
          )}

          {accepted && (
            <Card>
              <CardTitle>Matched with {accepted.clinicians?.name}</CardTitle>
              <DefinitionList
                items={[
                  ["Accepted", <When key="a" at={accepted.responded_at} uk={viewer.showUkTime} />],
                  ["Intro call", accepted.intro_calls[0]?.scheduled_at ? <When key="i" at={accepted.intro_calls[0].scheduled_at} uk={viewer.showUkTime} /> : "Not booked yet"],
                  ["Intro outcome", accepted.intro_calls.find((c) => c.outcome)?.outcome?.replaceAll("_", " ")],
                  ["First session", <DateOnly key="f" date={firstOf(accepted.conversions)?.first_session_at} />],
                ]}
              />
              {family.status !== "converted" && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-brand-700">Record on the clinician&apos;s behalf</summary>
                  <div className="mt-3 space-y-4">
                    {family.status !== "intro_done" && <IntroOutcomeForm action={actions.recordIntroOnBehalf.bind(null, family.id, accepted.id)} />}
                    <FirstSessionForm action={actions.confirmFirstSessionOnBehalf.bind(null, family.id, accepted.id)} />
                  </div>
                </details>
              )}
            </Card>
          )}

          {children.map((c) => (
            <Card key={c.id}>
              <CardTitle>
                {c.first_name}, {ageFrom(c.dob, c.age_years, today)}
              </CardTitle>
              <DefinitionList
                items={[
                  ["Service", SERVICE_LABELS[c.service_type]],
                  ["Concerns", c.concerns.map((x) => CONCERN_LABELS[x as Concern] ?? x).join(", ") + (c.concern_other ? ` (${c.concern_other})` : "")],
                  ["Preferred times", c.preferred_times.map((t) => TIME_BLOCK_LABELS[t]).join(", ") || "Any"],
                  ["Language", c.language],
                ]}
              />
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-brand-700">Edit</summary>
                <div className="mt-3">
                  <ChildForm action={actions.updateChild.bind(null, c.id, family.id)} child={c} />
                </div>
              </details>
            </Card>
          ))}

          <Card>
            <CardTitle>Referral history</CardTitle>
            {matches.length === 0 ? (
              <EmptyState>No offers yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {m.clinicians?.name} <span className="text-stone-500">#{m.rank}</span>
                      {m.response_reason && <span className="block text-xs text-stone-500">{m.response_reason}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <MatchStateBadge state={m.state} />
                      <span className="text-xs text-stone-500">
                        <When at={m.responded_at ?? m.offered_at ?? m.proposed_at} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Contact</CardTitle>
            <DefinitionList
              items={[
                ["Mobile", <a key="m" href={`tel:${family.mobile}`} className="underline">{formatAuMobile(family.mobile)}</a>],
                ["Email", <a key="e" href={`mailto:${family.email}`} className="break-all underline">{family.email}</a>],
                ["Location", `${family.suburb} ${family.postcode}${family.state ? `, ${family.state}` : ""}`],
                ["Funding", FUNDING_LABELS[family.funding_type]],
                ["Plan manager", family.plan_manager],
                ["Heard via", family.referral_source],
                ["Enquired", <When key="c" at={family.created_at} uk={viewer.showUkTime} />],
              ]}
            />
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-brand-700">Edit</summary>
              <div className="mt-3">
                <FamilyDetailsForm action={actions.updateFamily.bind(null, family.id)} family={family} />
              </div>
            </details>
          </Card>

          {manualOptions.length > 0 && (
            <Card>
              <CardTitle>Change status</CardTitle>
              <StatusForm action={actions.changeStatus.bind(null, family.id)} options={manualOptions} />
            </Card>
          )}

          <Card>
            <CardTitle>Timeline</CardTitle>
            <ol className="space-y-2 text-sm">
              {((history ?? []) as StatusHistoryRow[]).map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{FAMILY_STATUS_LABELS[h.to_status as keyof typeof FAMILY_STATUS_LABELS] ?? h.to_status}</span>
                  <span className="block text-xs text-stone-500">
                    <When at={h.at} /> · {h.by ? names.get(h.by) ?? "Staff" : "Automatic"}
                    {h.reason && ` · ${h.reason}`}
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardTitle>Messages</CardTitle>
            {!messages?.length ? (
              <EmptyState>No messages yet.</EmptyState>
            ) : (
              <ul className="space-y-1 text-sm">
                {messages.map((m: { id: string; template: string; channel: string; status: string; scheduled_for: string; last_error: string | null }) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span>
                      {m.template.replaceAll("_", " ")} <span className="text-stone-500">({m.channel})</span>
                    </span>
                    <Badge tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : m.status === "queued" ? "blue" : "neutral"}>{m.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Consent</CardTitle>
            <ul className="space-y-1 text-sm">
              {(consents ?? []).map((c: { type: string; version: string; granted_at: string; withdrawn_at: string | null }) => (
                <li key={c.type}>
                  {c.type.replaceAll("_", " ")} · v{c.version} {c.withdrawn_at ? <Badge tone="red">withdrawn</Badge> : <Badge tone="green">given</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
