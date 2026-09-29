import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/** Who a service-role call acts for, recorded in the activity log (see the activity_log migration). */
export type Actor = "clinician" | "family";

/**
 * Service-role client. Bypasses row-level security, so it's only used for things with no
 * signed-in user: public form submissions, webhooks, one-click email links and scheduled jobs.
 * Pages used by clinicians or families pass `actor` so the activity log records who acted.
 */
export function createAdminClient(actor?: Actor) {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: actor ? { headers: { "x-perch-actor": actor } } : undefined,
  });
}
