import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/** Who a service-role call acts for, recorded in the activity log (see the activity_log migration). */
export type Actor = "clinician" | "family" | { staffId: string };

/**
 * Service-role client. Bypasses row-level security, so it's only used for things with no
 * signed-in user: public form submissions, webhooks, one-click email links and scheduled jobs.
 * Pages used by clinicians or families, and staff using a server-only function, pass `actor` so the
 * activity log records who acted.
 */
export function createAdminClient(actor?: Actor) {
  const headers: Record<string, string> | undefined = !actor
    ? undefined
    : typeof actor === "string"
      ? { "x-perch-actor": actor }
      : { "x-perch-actor": "staff", "x-perch-actor-id": actor.staffId };
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: headers ? { headers } : undefined,
  });
}
