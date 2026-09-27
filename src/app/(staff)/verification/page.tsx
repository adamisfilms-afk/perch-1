import Link from "next/link";
import { When, credentialLabel } from "@/components/display";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/lib/types";
import { verifyCredential } from "../clinicians/[id]/actions";
import { VerifyForm } from "../clinicians/[id]/clinician-forms";

export const metadata = { title: "Verification queue" };

export default async function VerificationPage({ searchParams }: PageProps<"/verification">) {
  await requireStaff();
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("credentials")
    .select("*, clinicians(name, status)")
    .eq("status", "pending")
    .order("created_at");
  const rows = (data ?? []) as (CredentialRow & { clinicians: { name: string; status: string } })[];

  return (
    <div>
      <PageHeader
        title="Verification queue"
        description="Documents clinicians have uploaded. Check each against the register or certificate, then verify. Paused clinicians go back to Active automatically once everything is current."
      />
      {notice === "verified" && <div className="mb-4"><Alert tone="green">Verified. If the clinician was paused for credentials and everything is now current, they&apos;re active again.</Alert></div>}
      {notice === "rejected" && <div className="mb-4"><Alert tone="green">Rejected. The clinician has been asked for a new copy.</Alert></div>}
      {rows.length === 0 ? (
        <EmptyState>Nothing waiting. Nice work.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {rows.map((c) => (
            <li key={c.id}>
              <Card>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">
                    <Link href={`/clinicians/${c.clinician_id}`} className="hover:underline">
                      {c.clinicians.name}
                    </Link>{" "}
                    · {credentialLabel(c.type)}
                  </h2>
                  <span className="text-xs text-stone-500">
                    uploaded <When at={c.created_at} />
                  </span>
                </div>
                <p className="mb-3 text-sm">
                  {c.number && <>Number {c.number} · </>}
                  {c.file_path ? (
                    <a href={`/api/files/${c.id}`} target="_blank" className="text-brand-700 underline">
                      Open the document
                    </a>
                  ) : (
                    "No file attached"
                  )}
                </p>
                <VerifyForm action={verifyCredential.bind(null, c.clinician_id, c.id)} type={c.type} expiresAt={c.expires_at} returnTo="verification" />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
