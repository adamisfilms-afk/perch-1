import { redirect } from "next/navigation";

// Older emails linked to /availability/…: the same link now opens the clinician's whole page.
export default async function AvailabilityRedirect({ params }: PageProps<"/availability/[token]">) {
  const { token } = await params;
  redirect(`/clinician/${token}#hours`);
}
