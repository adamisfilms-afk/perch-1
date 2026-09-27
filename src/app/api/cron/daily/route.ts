import { NextResponse, type NextRequest } from "next/server";
import { lookupAbn } from "@/lib/abn";
import { drainOutbox } from "@/lib/notifications/outbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronRequest } from "../auth";

export const maxDuration = 300;

// Daily: credential expiry and reminders (also run by pg_cron), ABN re-checks, then send messages.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = createAdminClient();
  const { data: daily, error } = await db.rpc("run_scheduled_jobs", { p_job: "daily" });

  // ABN periodic re-check (needs the ABN Lookup web service, so it runs here rather than in the database).
  const { data: setting } = await db.from("settings").select("value").eq("key", "abn_recheck_days").maybeSingle();
  const cutoff = new Date(Date.now() - Number(setting?.value ?? 90) * 86_400_000).toISOString();
  const { data: due } = await db
    .from("credentials")
    .select("clinician_id, number, clinicians!inner(status)")
    .eq("type", "abn")
    .eq("status", "verified")
    .lt("last_checked_at", cutoff)
    .in("clinicians.status", ["active", "paused"])
    .limit(50);
  let abnChecked = 0;
  for (const c of (due ?? []) as { clinician_id: string; number: string | null }[]) {
    if (!c.number) continue;
    const result = await lookupAbn(c.number);
    if (!result) continue; // service down: try again tomorrow
    await db.rpc("record_abn_check", { p_clinician: c.clinician_id, p_abn: result.abn, p_active: result.active, p_entity_name: result.entityName });
    abnChecked += 1;
  }

  const sent = await drainOutbox(200);
  return NextResponse.json({ daily, dailyError: error?.message, abnChecked, sent });
}
