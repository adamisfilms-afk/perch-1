import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

export type Role = "admin" | "coordinator" | "clinical_lead" | "clinician";
export const STAFF_ROLES: Role[] = ["admin", "coordinator", "clinical_lead"];

export interface Viewer {
  userId: string;
  email: string;
  role: Role;
  fullName: string;
  showUkTime: boolean;
  clinicianId: string | null;
  isStaff: boolean;
}

/** Whether multi-factor login is required. The database enforces the same setting in every access rule. */
export const requireMfaSetting = cache(async (): Promise<boolean> => {
  try {
    const { data } = await createAdminClient().from("settings").select("value").eq("key", "require_mfa").maybeSingle();
    return data?.value !== false;
  } catch {
    return true;
  }
});

/**
 * The signed-in person, with their role. Redirects to login (or the MFA step) when needed.
 * Cached per request.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  if ((await requireMfaSetting()) && claims.aal !== "aal2") redirect("/mfa");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email, show_uk_time, active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile || !profile.active) redirect("/login?error=no-access");

  let clinicianId: string | null = null;
  if (profile.role === "clinician") {
    const { data: c } = await supabase.from("clinicians").select("id").eq("user_id", claims.sub).maybeSingle();
    clinicianId = c?.id ?? null;
  }

  return {
    userId: claims.sub,
    email: profile.email,
    role: profile.role as Role,
    fullName: profile.full_name,
    showUkTime: profile.show_uk_time,
    clinicianId,
    isStaff: STAFF_ROLES.includes(profile.role as Role),
  };
});

export async function requireStaff(roles: Role[] = STAFF_ROLES): Promise<Viewer> {
  const viewer = await getViewer();
  if (!roles.includes(viewer.role)) redirect(viewer.role === "clinician" ? "/portal" : "/dashboard");
  return viewer;
}

export async function requireClinician(): Promise<Viewer & { clinicianId: string }> {
  const viewer = await getViewer();
  if (viewer.role !== "clinician" || !viewer.clinicianId) redirect("/dashboard");
  return viewer as Viewer & { clinicianId: string };
}

/** Turn a database error into a message a person can act on. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong";
  if (error.code === "42501") return error.message?.startsWith("permission denied") ? "You don't have access to do that" : error.message ?? "Not allowed";
  if (error.code === "23505") return "That already exists";
  return error.message ?? "Something went wrong";
}
