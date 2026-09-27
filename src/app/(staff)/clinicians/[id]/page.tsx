import Link from "next/link";
import { SimpleActionButton } from "@/components/forms";
import { notFound } from "next/navigation";
import { AvailabilityForm, ClinicianProfileForm } from "@/components/clinician-profile-form";
import { ClinicianStatusBadge, CredentialStatusBadge, DateOnly, When, credentialLabel } from "@/components/display";
import { Alert, Badge, Card, CardTitle, DefinitionList, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  AGE_GROUP_LABELS,
  CLINICIAN_STATUS_LABELS,
  CLINICIAN_TRANSITIONS,
  CREDENTIAL_TYPES,
  CREDENTIALS,
  DAY_LABELS,
  FUNDING_LABELS,
  INTEREST_LABELS,
  PROFESSION_LABELS,
  goLiveGapLabel,
  requiredCredentialTypes,
  type AgeGroup,
  type ClinicianStatus,
  type CredentialType,
} from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { todayInAustralia } from "@/lib/time";
import type { AvailabilityRow, ClinicianRow, CredentialRow, StatusHistoryRow } from "@/lib/types";
import * as actions from "./actions";
import { AbnForm, AgreementSignedForm, NotesForm, OffboardingForm, SightedForm, StatusForm, VerifyForm } from "./clinician-forms";

export const metadata = { title: "Clinician" };

export default async function ClinicianPage({ params, searchParams }: PageProps<"/clinicians/[id]">) {
  const viewer = await requireStaff();
  const { id } = await params;
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data: clinician } = await supabase.from("clinicians").select("*").eq("id", id).maybeSingle<ClinicianRow>();
  if (!clinician) notFound();
  await supabase.rpc("log_access", { p_entity_type: "clinicians", p_entity_id: id, p_action: "view" });

  const [{ data: creds }, { data: slots }, { data: agreements }, { data: gaps }, { data: history }, { data: matches }, { data: offboarding }, { data: people }] =
    await Promise.all([
      supabase.from("credentials").select("*").eq("clinician_id", id).order("created_at", { ascending: false }),
      supabase.from("availability").select("*").eq("clinician_id", id).order("day_of_week").order("start_time"),
      supabase.from("agreements").select("*").eq("clinician_id", id).order("created_at", { ascending: false }),
      supabase.rpc("clinician_go_live_gaps", { p_clinician: id }),
      supabase.from("status_history").select("*").eq("entity_type", "clinician").eq("entity_id", id).order("at", { ascending: false }),
      supabase.from("matches").select("id, state, family_id, offered_at, responded_at, children(first_name)").eq("clinician_id", id).not("offered_at", "is", null).order("offered_at", { ascending: false }).limit(20),
      supabase.from("offboarding_checklists").select("*").eq("clinician_id", id).maybeSingle(),
      supabase.from("profiles").select("id, full_name"),
    ]);

  const today = todayInAustralia();
  const credentials = (creds ?? []) as CredentialRow[];
  const required = requiredCredentialTypes(clinician.profession, clinician.home_visits);
  const optional = CREDENTIAL_TYPES.filter((t) => !required.includes(t) && t !== "drivers_licence" && t !== "car_insurance" && t !== "ahpra" && t !== "spa_cpsp");
  const current = (t: CredentialType) => credentials.find((c) => c.type === t && ["verified", "expired"].includes(c.status));
  const pending = credentials.filter((c) => c.status === "pending");
  const goLiveGaps = (gaps ?? []) as string[];
  const names = new Map((people ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  const statusOptions = (viewer.role === "admin" ? (Object.keys(CLINICIAN_STATUS_LABELS) as ClinicianStatus[]) : CLINICIAN_TRANSITIONS[clinician.status]).filter(
    (s) => s !== clinician.status,
  );
  const openAgreement = agreements?.find((a: { signed_at: string | null }) => !a.signed_at);
  const signedAgreement = agreements?.find((a: { signed_at: string | null }) => a.signed_at) as { version: string; signed_at: string } | undefined;
  const sightedTypes: CredentialType[] = ["drivers_licence", "car_insurance"];

  return (
    <div className="space-y-6">
      <PageHeader
        title={clinician.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ClinicianStatusBadge status={clinician.status} pauseReason={clinician.pause_reason} />
            {PROFESSION_LABELS[clinician.profession]}
            {clinician.ndis_registered && <Badge tone="blue">NDIS registered</Badge>}
          </span>
        }
        actions={<Link href="/clinicians" className="text-sm text-brand-700 underline">← All clinicians</Link>}
      />

      {notice === "verified" && <Alert tone="green">Document verified.</Alert>}
      {notice === "rejected" && <Alert tone="green">Document rejected. The clinician has been asked for a new copy.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {clinician.status !== "active" && clinician.status !== "offboarded" && (
            <Card>
              <CardTitle>Go-live checklist</CardTitle>
              {goLiveGaps.length === 0 ? (
                <Alert tone="green">Everything&apos;s in place. They can be set to Active.</Alert>
              ) : (
                <ul className="space-y-1 text-sm">
                  {goLiveGaps.map((g) => (
                    <li key={g} className="flex items-center gap-2">
                      <span aria-hidden className="text-red-600">✗</span> {goLiveGapLabel(g)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {!clinician.clinical_lead_approved_at && ["admin", "clinical_lead"].includes(viewer.role) && (
                  <SimpleActionButton action={actions.approveGoLive.bind(null, id)} label="Approve as clinical lead" variant="secondary" />
                )}
                {!clinician.user_id && <SimpleActionButton action={actions.invitePortal.bind(null, id)} label="Invite to the portal" variant="secondary" />}
              </div>
              {clinician.clinical_lead_approved_at && (
                <p className="mt-2 text-xs text-stone-500">
                  Approved by {names.get(clinician.clinical_lead_approved_by ?? "") ?? "clinical lead"} on <When at={clinician.clinical_lead_approved_at} />
                </p>
              )}
            </Card>
          )}

          <Card>
            <CardTitle>Credentials</CardTitle>
            {pending.length > 0 && (
              <div className="mb-4 space-y-3">
                {pending.map((c) => (
                  <div key={c.id} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
                    <p className="mb-2 font-medium">
                      {credentialLabel(c.type)} uploaded <When at={c.created_at} />
                      {c.file_path && (
                        <>
                          {" · "}
                          <a href={`/api/files/${c.id}`} target="_blank" className="text-brand-700 underline">
                            open file
                          </a>
                        </>
                      )}
                    </p>
                    <VerifyForm action={actions.verifyCredential.bind(null, id, c.id)} type={c.type} expiresAt={c.expires_at} />
                  </div>
                ))}
              </div>
            )}
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-stone-500">
                <tr>
                  <th className="py-1 font-medium">Document</th>
                  <th className="py-1 font-medium">Expires</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[...required, ...optional].map((t) => {
                  const c = current(t);
                  return (
                    <tr key={t}>
                      <td className="py-2 pr-2">
                        {CREDENTIALS[t].label}
                        {!required.includes(t) && <span className="text-xs text-stone-400"> (optional)</span>}
                        {c?.sighted_only && <span className="block text-xs text-stone-500">Sighted <DateOnly date={c.sighted_at} /></span>}
                        {c?.file_path && (
                          <a href={`/api/files/${c.id}`} target="_blank" className="block text-xs text-brand-700 underline">
                            open file
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-2">{c ? <DateOnly date={c.expires_at} /> : ""}</td>
                      <td className="py-2">
                        {c ? <CredentialStatusBadge status={c.status} expiresAt={c.expires_at} today={today} /> : required.includes(t) ? <Badge tone="red">Missing</Badge> : <span className="text-stone-400">–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-5 grid gap-5 border-t border-stone-100 pt-4 sm:grid-cols-2">
              {clinician.home_visits && <SightedForm action={actions.recordSighted.bind(null, id)} types={sightedTypes} />}
              <AbnForm action={actions.checkAbn.bind(null, id)} abn={clinician.abn} />
            </div>
          </Card>

          <Card>
            <CardTitle>Service agreement</CardTitle>
            {signedAgreement ? (
              <p className="text-sm">
                Version {signedAgreement.version} signed <When at={signedAgreement.signed_at} />
              </p>
            ) : openAgreement ? (
              <p className="text-sm">Sent for signature. Waiting for them to sign.</p>
            ) : (
              <p className="text-sm text-stone-600">Not sent yet.</p>
            )}
            <div className="mt-3 space-y-3">
              {!signedAgreement && !openAgreement && <SimpleActionButton action={actions.sendAgreement.bind(null, id)} label="Send for e-signature" variant="secondary" />}
              <details>
                <summary className="cursor-pointer text-sm text-brand-700">Signed outside Documenso?</summary>
                <div className="mt-2">
                  <AgreementSignedForm action={actions.recordAgreementSigned.bind(null, id)} />
                </div>
              </details>
            </div>
          </Card>

          <Card>
            <CardTitle>Profile and capacity</CardTitle>
            <DefinitionList
              items={[
                ["Contact", <span key="c">{clinician.email} · {formatAuMobile(clinician.mobile)}</span>],
                ["Service area", `${clinician.suburb ?? "?"} ${clinician.postcode ?? ""}${clinician.radius_km ? ` + ${clinician.radius_km} km` : ""}${clinician.service_postcodes.length ? ` · ${clinician.service_postcodes.join(", ")}` : ""}`],
                ["Ages", clinician.age_groups.map((a) => AGE_GROUP_LABELS[a as AgeGroup]).join(", ")],
                ["Funding", clinician.funding_types.map((f) => FUNDING_LABELS[f]).join(", ")],
                ["Interests", clinician.interests.map((i) => INTEREST_LABELS[i] ?? i).join(", ")],
                ["Times", ((slots ?? []) as AvailabilityRow[]).map((s) => `${DAY_LABELS[s.day_of_week]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`).join(", ")],
                ["Capacity", clinician.snoozed_until ? `Snoozed until ${clinician.snoozed_until}` : `${clinician.capacity_new} new families`],
              ]}
            />
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-brand-700">Edit profile</summary>
              <div className="mt-3">
                <ClinicianProfileForm action={actions.updateProfile.bind(null, id)} clinician={clinician} />
              </div>
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand-700">Edit available times</summary>
              <div className="mt-3">
                <AvailabilityForm action={actions.updateAvailability.bind(null, id)} slots={(slots ?? []) as AvailabilityRow[]} />
              </div>
            </details>
          </Card>

          <Card>
            <CardTitle>Referrals</CardTitle>
            {!matches?.length ? (
              <EmptyState>No referrals offered yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {(matches as unknown as { id: string; state: string; family_id: string; offered_at: string; children: { first_name: string } }[]).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 py-2">
                    <Link href={`/families/${m.family_id}`} className="underline">
                      {m.children.first_name}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-stone-500">
                      {m.state} · <When at={m.offered_at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {statusOptions.length > 0 && (
            <Card>
              <CardTitle>Status</CardTitle>
              <StatusForm action={actions.changeStatus.bind(null, id)} options={statusOptions} />
            </Card>
          )}

          {clinician.status === "offboarded" && (
            <Card>
              <CardTitle>Off-boarding</CardTitle>
              <OffboardingForm action={actions.updateOffboarding.bind(null, id)} checklist={offboarding as Record<string, unknown> | null} />
            </Card>
          )}

          <Card>
            <CardTitle>Application</CardTitle>
            <DefinitionList
              items={[
                ["Applied", <When key="a" at={clinician.created_at} />],
                ["Experience", clinician.experience_years !== null ? `${clinician.experience_years} years` : null],
                ["Suburbs", clinician.application.suburbs as string],
                ["Availability", clinician.application.availability as string],
                ["NDIS", clinician.application.ndis_registration_status as string],
                ["Heard via", clinician.application.referral_source as string],
                ["Screening call", clinician.application.screening_at ? <When key="s" at={clinician.application.screening_at as string} /> : null],
              ]}
            />
            <div className="mt-4">
              <NotesForm action={actions.updateScreeningNotes.bind(null, id)} notes={clinician.screening_notes} />
            </div>
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ol className="space-y-2 text-sm">
              {((history ?? []) as StatusHistoryRow[]).map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.to_status.replaceAll("_", " ")}</span>
                  <span className="block text-xs text-stone-500">
                    <When at={h.at} /> · {h.by ? names.get(h.by) ?? "Staff" : "Automatic"}
                    {h.reason && ` · ${h.reason}`}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
