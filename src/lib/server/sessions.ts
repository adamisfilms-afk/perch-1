import "server-only";

// The session log: what clinicians deliver to Perch families (see the sessions migration).

import { linkSecret, readLinkToken } from "../booking/links";
import { createAdminClient } from "../supabase/admin";
import { firstOf } from "../types";

export interface ServiceType {
  key: string;
  label: string;
  price_cents: number;
}

export interface SessionEntry {
  id: string;
  session_date: string;
  service_type: string;
  label: string;
  price_cents: number;
  status: "logged" | "voided";
  void_reason: string | null;
  logged_by: "clinician" | "staff";
  created_at: string;
  /** Who it was for, on a clinician's list. */
  client?: string;
}

export interface ConfirmationEntry {
  id: string;
  month: string;
  session_count: number;
  status: "pending" | "confirmed" | "disputed";
  note: string | null;
  responded_at: string | null;
}

type Db = { from: ReturnType<typeof createAdminClient>["from"] };

export async function loadServiceTypes(db: Db): Promise<ServiceType[]> {
  const { data } = await db.from("service_types").select("key, label, price_cents").eq("active", true).order("sort");
  return (data ?? []) as ServiceType[];
}

/** Sessions for a referral, a family or a clinician, newest first. */
export async function loadSessions(db: Db, column: "match_id" | "family_id" | "clinician_id", id: string): Promise<SessionEntry[]> {
  const { data } = await db
    .from("sessions")
    .select("id, session_date, service_type, price_cents, status, void_reason, logged_by, created_at, service_types(label), families(children(first_name, last_name))")
    .eq(column, id)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  type Row = Omit<SessionEntry, "label" | "client"> & {
    service_types: { label: string } | { label: string }[] | null;
    families: { children: { first_name: string; last_name: string | null }[] | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const child = firstOf(firstOf(r.families)?.children);
    return {
      id: r.id,
      session_date: r.session_date,
      service_type: r.service_type,
      label: firstOf(r.service_types)?.label ?? r.service_type,
      price_cents: r.price_cents,
      status: r.status,
      void_reason: r.void_reason,
      logged_by: r.logged_by,
      created_at: r.created_at,
      client: child ? [child.first_name, child.last_name].filter(Boolean).join(" ") : undefined,
    };
  });
}

export async function loadConfirmations(db: Db, familyId: string): Promise<ConfirmationEntry[]> {
  const { data } = await db
    .from("session_confirmations")
    .select("id, month, session_count, status, note, responded_at")
    .eq("family_id", familyId)
    .order("month", { ascending: false })
    .limit(24);
  return (data ?? []) as ConfirmationEntry[];
}

export interface SessionsCheckView {
  id: string;
  month: string;
  sessionCount: number;
  sessionDates: string[];
  status: ConfirmationEntry["status"];
  note: string | null;
  parentFirstName: string;
  clinicianFirstName: string;
}

/** A family's monthly check, from its signed link. */
export async function resolveSessionsCheck(token: string): Promise<SessionsCheckView | null> {
  const ref = readLinkToken(linkSecret(), token);
  if (!ref || ref.kind !== "sessions_check") return null;
  const { data } = await createAdminClient("family")
    .from("session_confirmations")
    .select("id, month, session_count, session_dates, status, note, families(parent_name, anonymised_at), clinicians(name)")
    .eq("id", ref.id)
    .maybeSingle();
  if (!data) return null;
  const d = data as unknown as {
    id: string;
    month: string;
    session_count: number;
    session_dates: string[];
    status: ConfirmationEntry["status"];
    note: string | null;
    families: { parent_name: string; anonymised_at: string | null } | null;
    clinicians: { name: string } | null;
  };
  const family = firstOf(d.families);
  if (!family || family.anonymised_at) return null;
  return {
    id: d.id,
    month: d.month,
    sessionCount: d.session_count,
    sessionDates: d.session_dates,
    status: d.status,
    note: d.note,
    parentFirstName: family.parent_name.split(" ")[0],
    clinicianFirstName: firstOf(d.clinicians)?.name.split(" ")[0] ?? "your clinician",
  };
}
