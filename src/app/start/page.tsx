import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

/** Sends people to the right home screen for their role. */
export default async function Start() {
  const viewer = await getViewer();
  redirect(viewer.role === "clinician" ? "/portal" : "/dashboard");
}
