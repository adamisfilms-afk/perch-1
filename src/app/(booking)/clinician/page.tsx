import { loadClinicianPage } from "@/lib/server/clinician-link";
import { currentClinicianId, maskEmail } from "@/lib/server/clinician-session";
import { ClinicianPageBody } from "./body";
import { ClinicianSignIn } from "./sign-in";

export const metadata = { title: "Your Perch page", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A clinician's own page. They sign in with their email and a 6-digit code; no family details are shown. */
export default async function ClinicianPage() {
  const clinicianId = await currentClinicianId();
  const view = clinicianId ? await loadClinicianPage(clinicianId) : null;
  if (!view) return <ClinicianSignIn token={null} maskedEmail={null} />;
  return <ClinicianPageBody view={view} signedInAs={maskEmail(view.clinician.email)} />;
}
