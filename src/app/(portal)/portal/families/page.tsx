import { Alert, Card, CardTitle, DefinitionList, EmptyState, PageHeader } from "@/components/ui";
import { DateOnly, When } from "@/components/display";
import { requireClinician } from "@/lib/auth";
import { CONCERN_LABELS, FUNDING_LABELS, SERVICE_LABELS, TIME_BLOCK_LABELS, type Concern } from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { ageFrom } from "@/lib/time";
import { firstOf, type ChildRow, type FamilyRow, type MatchRow } from "@/lib/types";
import { confirmFirstSession, recordIntro } from "../actions";
import { FirstSessionForm, IntroOutcomeForm } from "@/components/referral-forms";

export const metadata = { title: "My families" };

type Row = MatchRow & {
  families: FamilyRow;
  children: ChildRow;
  intro_calls: { scheduled_at: string | null; outcome: string | null }[];
  conversions: { first_session_at: string } | { first_session_at: string }[] | null;
};

const NOTICES: Record<string, string> = {
  accepted: "Thanks for accepting! We've sent the family your intro-call link. Their details are below.",
  intro: "Saved. Let us know once the first session is booked.",
  not_going_ahead: "Thanks for letting us know. We'll find the family another clinician.",
  converted: "Great, first session confirmed 🎉 From here the family is managed in your Halaxy.",
};

export default async function MyFamilies({ searchParams }: PageProps<"/portal/families">) {
  const viewer = await requireClinician();
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("matches")
    .select("*, families(*), children(*), intro_calls(scheduled_at, outcome), conversions(first_session_at)")
    .eq("clinician_id", viewer.clinicianId)
    .eq("state", "accepted")
    .order("responded_at", { ascending: false });
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.families && r.children);
  for (const r of rows) await supabase.rpc("log_access", { p_entity_type: "families", p_entity_id: r.family_id, p_action: "view" });

  return (
    <div className="space-y-6">
      <PageHeader title="My families" description="Families you've accepted. Once the first session is booked, they're managed in your Halaxy." />
      {typeof notice === "string" && NOTICES[notice] && <Alert tone="green">{NOTICES[notice]}</Alert>}
      {rows.length === 0 ? (
        <EmptyState>No families yet.</EmptyState>
      ) : (
        rows.map((r) => {
          const f = r.families;
          const c = r.children;
          const intro = r.intro_calls.find((i) => i.scheduled_at);
          const outcome = r.intro_calls.find((i) => i.outcome)?.outcome;
          const converted = firstOf(r.conversions);
          return (
            <Card key={r.id} id={r.id}>
              <CardTitle>
                {c.first_name}, {ageFrom(c.dob, c.age_years)} · {f.parent_name}
              </CardTitle>
              <DefinitionList
                items={[
                  ["Mobile", <a key="m" className="underline" href={`tel:${f.mobile}`}>{formatAuMobile(f.mobile)}</a>],
                  ["Email", <a key="e" className="break-all underline" href={`mailto:${f.email}`}>{f.email}</a>],
                  ["Suburb", `${f.suburb} ${f.postcode}`],
                  ["Service", SERVICE_LABELS[c.service_type]],
                  ["Concerns", c.concerns.map((x) => CONCERN_LABELS[x as Concern] ?? x).join(", ")],
                  ["Funding", `${FUNDING_LABELS[f.funding_type]}${f.plan_manager ? ` · plan manager: ${f.plan_manager}` : ""}`],
                  ["Times", c.preferred_times.map((t) => TIME_BLOCK_LABELS[t]).join(", ")],
                  ["Language", c.language],
                  ["Notes from intake", c.notes_intake],
                  ["Intro call", intro ? <When key="i" at={intro.scheduled_at} /> : "Not booked yet"],
                  ["First session", converted ? <DateOnly key="d" date={converted.first_session_at} /> : null],
                ]}
              />
              {!converted && (
                <div className="mt-4 space-y-4 border-t border-stone-100 pt-4">
                  {!outcome && <IntroOutcomeForm action={recordIntro.bind(null, r.id)} />}
                  <FirstSessionForm action={confirmFirstSession.bind(null, r.id)} />
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
