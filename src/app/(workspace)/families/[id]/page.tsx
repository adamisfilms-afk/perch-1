import Link from "next/link";
import { SimpleActionButton } from "@/components/forms";
import { FirstSessionForm, IntroOutcomeForm } from "@/components/referral-forms";
import { notFound } from "next/navigation";
import { DateOnly, MatchStateBadge, When } from "@/components/display";
import { Alert, Badge, Card, CardTitle, DefinitionList, EmptyState } from "@/components/ui";
import { RecordHeader } from "@/components/workspace/summary-parts";
import { requireStaff } from "@/lib/auth";
import { allocationBlockedReason, childFullName } from "@/lib/client-summary";
import {
  CONCERN_LABELS,
  FAMILY_TRANSITIONS,
  FUNDING_LABELS,
  MANUAL_FAMILY_STATUSES,
  SERVICE_LABELS,
  TIME_BLOCK_LABELS,
  type Concern,
} from "@/lib/domain";
import { AllocateClinician } from "@/components/workspace/allocate-clinician";
import { formatAuMobile } from "@/lib/phone";
import { RecentActivity } from "@/components/workspace/recent-activity";
import { loadActivity } from "@/lib/server/activity";
import { createClient } from "@/lib/supabase/server";
import { ageFrom, relativeHours, hoursSince, todayInAustralia } from "@/lib/time";
import { firstOf, type ChildRow, type FamilyRow, type MatchRow } from "@/lib/types";
import { getClientDetail } from "../../clients/actions";
import { CLIENT_TABS, ClientBookings, ClientHistory } from "../../clients/client-detail";
import { StatusPill } from "../../clients/client-table";
import * as actions from "./actions";
import { ChildForm, FamilyDetailsForm, IntakeForm, StatusForm } from "./family-forms";

export const metadata = { title: "Family" };

type MatchWithClinician = MatchRow & { clinicians: { name: string } | null; intro_calls: { scheduled_at: string | null; outcome: string | null }[]; conversions: { first_session_at: string } | { first_session_at: string }[] | null };

const NOTICES: Record<string, string> = {
  intake_ready_to_match: "Intake saved. The family is ready to match: allocate a clinician below.",
  intake_needs_follow_up: "Intake saved. The family is back in Contacted for follow-up.",
  intake_not_suitable: "Intake saved. The family has been sent the signposting message.",
  waitlist: "Moved to the waitlist. You'll be alerted when capacity frees up.",
  intro: "Intro call outcome saved.",
  converted: "First session confirmed. The family is converted 🎉",
  status: "Status updated.",
};

const TABS = [{ id: "overview", label: "Overview" }, ...CLIENT_TABS.filter((t) => t.id !== "info")];

function Header({ family, childNames, tab }: { family: FamilyRow; childNames: string; tab: string }) {
  return (
    <RecordHeader
      back={{ href: "/clients", label: "Clients" }}
      title={childNames || family.parent_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>Parent: {family.parent_name} ·</span>
          <StatusPill status={family.status} />
          <span>
            for {relativeHours(hoursSince(family.status_changed_at))}
            {family.status_reason && ` · ${family.status_reason}`}
          </span>
          {family.complex_case && <Badge tone="violet">Complex case</Badge>}
        </span>
      }
      tabs={TABS}
      active={tab}
      basePath={`/families/${family.id}`}
    />
  );
}

export default async function FamilyPage({ params, searchParams }: PageProps<"/families/[id]">) {
  const viewer = await requireStaff();
  const { id } = await params;
  const { notice, tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.id === tabParam) ? (tabParam as string) : "overview";

  // Bookings and History show the same views as the client summary modal (which logs the view itself).
  if (tab !== "overview") {
    const result = await getClientDetail(id);
    if (!result.ok) notFound();
    const { detail } = result;
    return (
      <div className="flex min-h-full flex-col">
        <Header family={detail.family} childNames={detail.children.map(childFullName).join(" & ")} tab={tab} />
        <div className="max-w-3xl px-4 py-6 md:px-8">{tab === "bookings" ? <ClientBookings detail={detail} /> : <ClientHistory detail={detail} />}</div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: family } = await supabase.from("families").select("*").eq("id", id).maybeSingle<FamilyRow>();
  if (!family) notFound();
  await supabase.rpc("log_access", { p_entity_type: "families", p_entity_id: id, p_action: "view" });

  const [{ data: childRows }, { data: intake }, { data: matchRows }, { data: messages }, { data: people }, { data: consents }] =
    await Promise.all([
      supabase.from("children").select("*").eq("family_id", id).order("created_at"),
      supabase.from("intake_calls").select("*").eq("family_id", id).order("created_at", { ascending: false }),
      supabase
        .from("matches")
        .select("*, clinicians(name), intro_calls(scheduled_at, outcome), conversions(first_session_at)")
        .eq("family_id", id)
        .order("created_at", { ascending: false }),
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
  const activity = await loadActivity(supabase, "family", id, names);
  const today = todayInAustralia();

  const inIntake = ["new", "contacted", "intake_booked", "intake_done"].includes(family.status);
  const accepted = matches.find((m) => m.state === "accepted");
  const offered = matches.find((m) => m.state === "offered");
  const manualOptions = MANUAL_FAMILY_STATUSES.filter((s) => FAMILY_TRANSITIONS[family.status].includes(s) || viewer.role === "admin").filter(
    (s) => s !== family.status,
  );
  const lastIntake = intake?.find((i: { completed_at: string | null }) => i.completed_at) as { answers: Record<string, string | null>; notes: string | null } | undefined;
  const nextIntake = intake?.find((i: { completed_at: string | null; scheduled_at: string | null }) => !i.completed_at && i.scheduled_at) as
    | { scheduled_at: string }
    | undefined;

  return (
    <div className="flex min-h-full flex-col">
      <Header family={family} childNames={children.map(childFullName).join(" & ")} tab="overview" />
      <div className="space-y-6 px-4 py-6 md:px-8">

      {typeof notice === "string" && NOTICES[notice] && <Alert tone="green">{NOTICES[notice]}</Alert>}

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

          {child && (
            <Card>
              <CardTitle>Clinician</CardTitle>
              <AllocateClinician
                familyId={family.id}
                current={accepted ? { id: accepted.clinician_id, name: accepted.clinicians?.name ?? "Clinician" } : null}
                pending={offered ? { id: offered.clinician_id, name: offered.clinicians?.name ?? "Clinician", expiresAt: offered.offer_expires_at } : null}
                blockedReason={allocationBlockedReason(family.status)}
              />
              {family.status === "ready_to_match" && (
                <div className="mt-4 border-t border-stone-100 pt-4">
                  <p className="mb-2 text-sm text-stone-600">No clinician available yet?</p>
                  <SimpleActionButton action={actions.moveToWaitlist.bind(null, family.id)} label="Move to waitlist" variant="secondary" />
                </div>
              )}
            </Card>
          )}

          {accepted && (
            <Card>
              <CardTitle>Intro and first session with {accepted.clinicians?.name}</CardTitle>
              <DefinitionList
                items={[
                  ["Allocated", <When key="a" at={accepted.responded_at} uk={viewer.showUkTime} />],
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
                {childFullName(c)}, {ageFrom(c.dob, c.age_years, today)}
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
            <CardTitle>Clinician history</CardTitle>
            {matches.length === 0 ? (
              <EmptyState>No clinician allocated yet.</EmptyState>
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
            <CardTitle action={<Link href={`/families/${family.id}?tab=history`} className="text-sm text-stone-600 underline underline-offset-4">Full history</Link>}>
              Recent activity
            </CardTitle>
            <RecentActivity items={activity.filter((a) => a.source === "event").slice(0, 8)} />
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
    </div>
  );
}
