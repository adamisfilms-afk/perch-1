// Test harness: builds a throwaway Postgres database with the Supabase shim and every
// migration applied, then runs queries as specific users (anon, staff, clinician, service role)
// exactly the way PostgREST does: SET ROLE plus request.jwt.claims.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "";

export type Actor =
  | { kind: "postgres" }
  | { kind: "anon" }
  | { kind: "service" }
  | { kind: "user"; id: string; aal?: "aal1" | "aal2" };

export const POSTGRES: Actor = { kind: "postgres" };
export const ANON: Actor = { kind: "anon" };
export const SERVICE: Actor = { kind: "service" };
export const user = (id: string, aal: "aal1" | "aal2" = "aal2"): Actor => ({ kind: "user", id, aal });

export class TestDb {
  private constructor(
    private readonly client: Client,
    private readonly name: string,
  ) {}

  static async create(): Promise<TestDb> {
    const name = `sb_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();

    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    await client.query("set client_min_messages = warning");
    await client.query(readFileSync(path.join(ROOT, "supabase/tests/supabase_shim.sql"), "utf8"));
    const dir = path.join(ROOT, "supabase/migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await client.query(readFileSync(path.join(dir, f), "utf8"));
    }
    return new TestDb(client, name);
  }

  async destroy(): Promise<void> {
    await this.client.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name} with (force)`);
    await admin.end();
  }

  /** Run one statement as the given actor, in its own committed transaction. */
  async q<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
    await this.client.query("begin");
    try {
      if (actor.kind !== "postgres") {
        const role = actor.kind === "anon" ? "anon" : actor.kind === "service" ? "service_role" : "authenticated";
        const claims =
          actor.kind === "user"
            ? { sub: actor.id, role: "authenticated", aal: actor.aal ?? "aal2" }
            : { role: actor.kind === "anon" ? "anon" : "service_role" };
        await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await this.client.query(`set local role ${role}`);
      }
      const res = await this.client.query(sql, params);
      await this.client.query("commit");
      return res.rows as T[];
    } catch (e) {
      await this.client.query("rollback");
      throw e;
    }
  }

  async one<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(actor, sql, params);
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Fixtures (inserted as postgres, bypassing RLS)
  // ---------------------------------------------------------------------------

  async createUser(role: "admin" | "coordinator" | "clinical_lead" | "clinician", name: string = role): Promise<string> {
    const id = randomUUID();
    const email = `${name.replace(/\W/g, "").toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await this.q(POSTGRES, "insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await this.q(POSTGRES, "insert into public.profiles (id, role, full_name, email) values ($1, $2, $3, $4)", [
      id,
      role,
      name,
      email,
    ]);
    return id;
  }

  /** A fully credentialed, approved, active clinician near Parramatta. */
  async createActiveClinician(opts: { name?: string; ndis?: boolean; capacity?: number; lat?: number; lng?: number } = {}): Promise<{
    clinicianId: string;
    userId: string;
  }> {
    const userId = await this.createUser("clinician", opts.name ?? "Clinician");
    const lead = await this.createUser("clinical_lead", "Lead");
    const { id } = await this.one<{ id: string }>(
      POSTGRES,
      `insert into public.clinicians (user_id, name, email, mobile, profession, age_groups, base_lat, base_lng, radius_km,
                                      funding_types, ndis_registered, capacity_new, calcom_intro_url, status,
                                      clinical_lead_approved_by, clinical_lead_approved_at, gender, home_visits)
       values ($1, $2, $3, '+61412345678', 'speech_pathologist', '{3-5,6-12}', $4, $5, 15,
               '{private,ndis_plan_managed,ndis_self_managed,ndis_agency_managed}', $6, $7, 'https://cal.com/x/intro',
               'agreement_signed', $8, now(), 'female', true)
       returning id`,
      [userId, opts.name ?? "Clinician", `c-${userId.slice(0, 8)}@example.com`, opts.lat ?? -33.815, opts.lng ?? 151.001, opts.ndis ?? true, opts.capacity ?? 2, lead],
    );
    await this.addAllCredentials(id);
    await this.q(POSTGRES, "insert into public.agreements (clinician_id, version, signed_at) values ($1, '1.0', now())", [id]);
    await this.q(POSTGRES, "insert into public.availability (clinician_id, day_of_week, start_time, end_time) values ($1, 2, '15:00', '18:00')", [id]);
    await this.q(POSTGRES, "update public.clinicians set status = 'active' where id = $1", [id]);
    return { clinicianId: id, userId };
  }

  async addAllCredentials(clinicianId: string, expires = "2030-01-01"): Promise<void> {
    const types = ["spa_cpsp", "wwcc", "ndis_worker_screening", "ndis_orientation", "pi_insurance", "pl_insurance", "abn"];
    for (const t of types) {
      await this.q(
        POSTGRES,
        `insert into public.credentials (clinician_id, type, expires_at, status, verified_at)
         values ($1, $2, $3, 'verified', now())`,
        [clinicianId, t, t === "ndis_orientation" || t === "abn" ? null : expires],
      );
    }
    for (const t of ["drivers_licence", "car_insurance"]) {
      await this.q(
        POSTGRES,
        `insert into public.credentials (clinician_id, type, expires_at, status, verified_at, sighted_only, sighted_at)
         values ($1, $2, $3, 'verified', now(), true, current_date)`,
        [clinicianId, t, expires],
      );
    }
  }

  /** A family that has finished intake and is ready to match. Returns ids. */
  async createReadyFamily(opts: { funding?: string; complex?: boolean } = {}): Promise<{ familyId: string; childId: string }> {
    const familyId = await this.submitEnquiry({ funding_type: opts.funding ?? "private" });
    await this.q(POSTGRES, "update public.families set status = 'intake_done' where id = $1", [familyId]);
    await this.q(POSTGRES, "update public.families set status = 'ready_to_match', complex_case = $2 where id = $1", [
      familyId,
      opts.complex ?? false,
    ]);
    const { id: childId } = await this.one<{ id: string }>(POSTGRES, "select id from public.children where family_id = $1", [familyId]);
    return { familyId, childId };
  }

  async submitEnquiry(overrides: Record<string, unknown> = {}): Promise<string> {
    const payload = {
      parent_name: "Sam Parent",
      email: `parent-${randomUUID().slice(0, 6)}@example.com`,
      mobile: "+61412000111",
      suburb: "Parramatta",
      postcode: "2150",
      state: "NSW",
      lat: -33.8148,
      lng: 151.0017,
      child_first_name: "Alex",
      age_years: 5,
      concerns: ["speech_sounds"],
      service_type: "speech",
      funding_type: "private",
      preferred_times: ["after_school"],
      consent_privacy: true,
      consent_contact: true,
      consent_share: true,
      ...overrides,
    };
    const { submit_enquiry } = await this.one<{ submit_enquiry: string }>(SERVICE, "select public.submit_enquiry($1)", [
      JSON.stringify(payload),
    ]);
    return submit_enquiry;
  }

  async shortlistAndApprove(approver: string, childId: string, clinicianIds: string[]): Promise<void> {
    const items = clinicianIds.map((id, i) => ({ clinician_id: id, rank: i + 1, rule_score: 90 - i }));
    await this.q(user(approver), "select public.propose_shortlist($1, $2)", [childId, JSON.stringify(items)]);
    await this.q(user(approver), "select public.approve_shortlist($1)", [childId]);
  }

  async matchStates(childId: string): Promise<Record<string, string>> {
    const rows = await this.q<{ clinician_id: string; state: string }>(
      POSTGRES,
      "select clinician_id, state from public.matches where child_id = $1",
      [childId],
    );
    return Object.fromEntries(rows.map((r) => [r.clinician_id, r.state]));
  }

  async familyStatus(familyId: string): Promise<string> {
    return (await this.one<{ status: string }>(POSTGRES, "select status from public.families where id = $1", [familyId])).status;
  }
}

export const hasDatabase = Boolean(ADMIN_URL);
