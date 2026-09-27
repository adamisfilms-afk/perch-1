import { CredentialStatusBadge, DateOnly, credentialLabel } from "@/components/display";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { requireClinician } from "@/lib/auth";
import { CREDENTIAL_TYPES, CREDENTIALS, requiredCredentialTypes } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { todayInAustralia } from "@/lib/time";
import type { ClinicianRow, CredentialRow } from "@/lib/types";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const viewer = await requireClinician();
  const supabase = await createClient();
  const [{ data: me }, { data: creds }] = await Promise.all([
    supabase.from("clinicians").select("*").eq("id", viewer.clinicianId).single<ClinicianRow>(),
    supabase.from("credentials").select("*").eq("clinician_id", viewer.clinicianId).neq("status", "superseded").order("created_at", { ascending: false }),
  ]);
  if (!me) return null;
  const today = todayInAustralia();
  const required = requiredCredentialTypes(me.profession, me.home_visits);
  const uploadable = CREDENTIAL_TYPES.filter((t) => !CREDENTIALS[t].sightedOnly && t !== "abn" && (t !== (me.profession === "speech_pathologist" ? "ahpra" : "spa_cpsp")));
  const list = (creds ?? []) as CredentialRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Upload new certificates here. We check each one and let you know. Your driver's licence and car insurance are sighted by the team instead, so there's nothing to upload." />
      <Card>
        <CardTitle>Upload a document</CardTitle>
        <UploadForm types={uploadable.map((t) => [t, CREDENTIALS[t].label, CREDENTIALS[t].expiryTracked] as const)} />
      </Card>
      <Card>
        <CardTitle>Your documents</CardTitle>
        <ul className="divide-y divide-stone-100 text-sm">
          {required.map((t) => {
            const c = list.find((x) => x.type === t);
            return (
              <li key={t} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {credentialLabel(t)}
                  {c?.expires_at && (
                    <span className="block text-xs text-stone-500">
                      expires <DateOnly date={c.expires_at} />
                    </span>
                  )}
                  {c?.status === "rejected" && <span className="block text-xs text-red-700">{c.rejection_reason}</span>}
                </span>
                {c ? <CredentialStatusBadge status={c.status} expiresAt={c.expires_at} today={today} /> : <Badge tone="red">Needed</Badge>}
              </li>
            );
          })}
          {list
            .filter((c) => !required.includes(c.type))
            .map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{credentialLabel(c.type)}</span>
                <CredentialStatusBadge status={c.status} expiresAt={c.expires_at} today={today} />
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
