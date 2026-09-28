import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

/** Sends people to the right home screen for their role. Clinicians sign in to /clinician with an emailed code instead. */
export default async function Start() {
  const viewer = await getViewer();
  redirect(viewer.role === "clinician" ? "/clinician" : "/dashboard");
}
