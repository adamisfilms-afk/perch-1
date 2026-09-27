import "server-only";

import { env } from "../env";
import { createAdminClient } from "../supabase/admin";

/**
 * Create the clinician's portal login (or, if they already have one, a fresh sign-in link) and queue
 * the welcome email with the link. The link comes from Supabase but is sent through our own outbox,
 * so it doesn't depend on Supabase's built-in mailer.
 */
export async function sendPortalInvite(clinicianId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: clinician } = await admin.from("clinicians").select("id, email, user_id").eq("id", clinicianId).single<{
    id: string;
    email: string;
    user_id: string | null;
  }>();
  if (!clinician) return { ok: false, error: "Clinician not found" };

  const type = clinician.user_id ? "recovery" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({
    type,
    email: clinician.email,
    options: { redirectTo: `${env.appUrl()}/auth/confirm` },
  });
  if (error || !data.user || !data.properties?.hashed_token) {
    return { ok: false, error: error?.message ?? "Couldn't create the sign-in link" };
  }
  const { error: linkError } = await admin.rpc("link_clinician_portal", {
    p_clinician: clinician.id,
    p_user: data.user.id,
    p_token_hash: data.properties.hashed_token,
    p_link_type: type,
  });
  if (linkError) return { ok: false, error: linkError.message };
  return { ok: true };
}
