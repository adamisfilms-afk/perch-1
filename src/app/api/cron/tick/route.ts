import { NextResponse, type NextRequest } from "next/server";
import { drainOutbox } from "@/lib/notifications/outbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronRequest } from "../auth";

export const maxDuration = 60;

// Every few minutes: offer timeouts and nudges (also run by pg_cron), then send due messages.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data: offers, error } = await createAdminClient().rpc("run_scheduled_jobs", { p_job: "offers" });
  const sent = await drainOutbox(100);
  return NextResponse.json({ offers, offersError: error?.message, sent });
}
