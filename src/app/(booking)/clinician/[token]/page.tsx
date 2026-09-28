import { redirect } from "next/navigation";
import { resolveClinicianLink } from "@/lib/server/clinician-link";
import { currentClinicianId, maskEmail } from "@/lib/server/clinician-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClinicianSignIn } from "../sign-in";

export const metadata = { title: "Your Perch page", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The link in a clinician's emails. It says who they are, so they don't have to type their email, but it
 * doesn't sign them in: they still need the emailed code (unless this device is already signed in as them).
 */
export default async function ClinicianLink({ params }: PageProps<"/clinician/[token]">) {
  const { token } = await params;
  const [link, signedIn] = await Promise.all([resolveClinicianLink(token), currentClinicianId()]);
  if (signedIn && (!link || signedIn === link.clinicianId)) redirect("/clinician");
  if (!link) return <ClinicianSignIn token={null} maskedEmail={null} />;
  const { data } = await createAdminClient().from("clinicians").select("email").eq("id", link.clinicianId).maybeSingle();
  return <ClinicianSignIn token={token} maskedEmail={data?.email ? maskEmail(data.email as string) : null} />;
}
