import { loadClinicianPage, resolveClinicianLink } from "@/lib/server/clinician-link";
import { LinkExpired } from "../../link-expired";
import { ClinicianPageBody } from "./body";

export const metadata = { title: "Your Perch page", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A clinician's own page, opened from the private link in their emails. No login, and no family details. */
export default async function ClinicianPage({ params }: PageProps<"/clinician/[token]">) {
  const { token } = await params;
  const link = await resolveClinicianLink(token);
  const view = link ? await loadClinicianPage(link.clinicianId, token) : null;
  if (!view) return <LinkExpired />;
  return <ClinicianPageBody view={view} />;
}
