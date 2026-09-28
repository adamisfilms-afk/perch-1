import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

/** Sends people to the right home screen for their role. Clinicians have no login any more: /link emails them their page. */
export default async function Start() {
  const viewer = await getViewer();
  redirect(viewer.role === "clinician" ? "/link" : "/dashboard");
}
