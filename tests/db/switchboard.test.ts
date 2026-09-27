// Database behaviour tests: access rules, status machines, the go-live gate,
// referral offers and credential automation. Needs TEST_DATABASE_URL (see README).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANON, POSTGRES, SERVICE, TestDb, hasDatabase, user } from "./harness";

const d = hasDatabase ? describe : describe.skip;

d("database", () => {
  let db: TestDb;
  let admin: string;
  let coordinator: string;
  let lead: string;

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await db.createUser("admin", "Adam Admin");
    coordinator = await db.createUser("coordinator", "Casey Coordinator");
    lead = await db.createUser("clinical_lead", "Lee Lead");
  });

  afterAll(async () => {
    await db?.destroy();
  });

  describe("access control", () => {
    it("gives the public no direct table access", async () => {
      await expect(db.q(ANON, "select * from public.families")).rejects.toThrow(/permission denied/);
      await expect(db.q(ANON, "select public.submit_enquiry('{}')")).rejects.toThrow(/permission denied/);
    });

    it("keeps server-only functions away from signed-in users", async () => {
      const { userId } = await db.createActiveClinician();
      for (const call of [
        "select * from public.claim_messages(10)",
        "select public.complete_message(gen_random_uuid(), 'sent')",
        "select public.submit_enquiry('{}')",
        "select public.record_booking('intake', null, 'x@example.com', now(), 'u')",
        "select public.peek_action_token('x')",
        "select public.check_rate_limit('k', 1, 60)",
      ]) {
        await expect(db.q(user(userId), call)).rejects.toThrow(/permission denied/);
        await expect(db.q(user(coordinator), call)).rejects.toThrow(/permission denied/);
      }
    });

    it("hides everything from staff who haven't completed multi-factor login", async () => {
      await db.submitEnquiry();
      const aal1 = await db.q(user(coordinator, "aal1"), "select id from public.families");
      const aal2 = await db.q(user(coordinator, "aal2"), "select id from public.families");
      expect(aal1).toHaveLength(0);
      expect(aal2.length).toBeGreaterThan(0);
    });

    it("lets staff read the client summary targets but only admins change them", async () => {
      const read = await db.q<{ value: Record<string, number> }>(user(coordinator), "select value from public.settings where key = 'client_kpi_targets'");
      expect(read[0].value.active_rate_pct).toBe(50);
      const blocked = await db.q(user(coordinator), `update public.settings set value = '{"active_rate_pct": 90}' where key = 'client_kpi_targets' returning key`);
      expect(blocked).toHaveLength(0);
      const saved = await db.q(user(admin), `update public.settings set value = value || '{"active_rate_pct": 60}' where key = 'client_kpi_targets' returning key`);
      expect(saved).toHaveLength(1);
      await db.q(POSTGRES, `update public.settings set value = value || '{"active_rate_pct": 50}' where key = 'client_kpi_targets'`);
    });

    it("pings the app's tick endpoint only from the scheduler, and does nothing until configured", async () => {
      await expect(db.q(POSTGRES, "select private.ping_app_tick()")).resolves.toHaveLength(1);
      await expect(db.q(user(admin), "select private.ping_app_tick()")).rejects.toThrow(/permission denied/);
    });

    it("keeps the audit log and finance admin-only", async () => {
      expect(await db.q(user(coordinator), "select * from public.audit_log")).toHaveLength(0);
      expect((await db.q(user(admin), "select * from public.audit_log")).length).toBeGreaterThan(0);
    });

    it("logs which columns changed, never the values", async () => {
      const familyId = await db.submitEnquiry();
      await db.q(user(coordinator), "update public.families set plan_manager = 'Secret PM' where id = $1", [familyId]);
      const log = await db.one<{ user_id: string; detail: { changed: string[] } }>(
        POSTGRES,
        "select user_id, detail from public.audit_log where entity_id = $1 and action = 'update' order by id desc limit 1",
        [familyId],
      );
      expect(log.user_id).toBe(coordinator);
      expect(log.detail.changed).toEqual(["plan_manager"]);
      expect(JSON.stringify(log)).not.toContain("Secret PM");
    });
  });

  describe("family funnel", () => {
    it("creates the family, child, versioned consents, history and messages from an enquiry", async () => {
      const familyId = await db.submitEnquiry();
      expect(await db.familyStatus(familyId)).toBe("new");
      const consents = await db.q(POSTGRES, "select type, version from public.consents where family_id = $1 order by type", [familyId]);
      expect(consents.map((c) => c.type)).toEqual(["contact", "privacy_collection", "share_with_clinician"]);
      expect(consents[0].version).toBe("2026-09");
      const history = await db.q(POSTGRES, "select from_status, to_status from public.status_history where entity_id = $1", [familyId]);
      expect(history).toEqual([{ from_status: null, to_status: "new" }]);
      const messages = await db.q<{ template: string; channel: string }>(
        POSTGRES,
        "select template, channel from public.message_log where recipient_id = $1 or payload->>'family_id' = $1::text order by template, channel",
        [familyId],
      );
      expect(messages).toEqual([
        { template: "enquiry_received", channel: "email" },
        { template: "enquiry_received", channel: "sms" },
        { template: "new_enquiry", channel: "email" },
        { template: "new_enquiry", channel: "slack" },
      ]);
    });

    it("keeps the child's last name from the enquiry, and clears it when the family is anonymised", async () => {
      const familyId = await db.submitEnquiry({ child_first_name: "Noah", child_last_name: " Martin " });
      const [child] = await db.q(POSTGRES, "select first_name, last_name from public.children where family_id = $1", [familyId]);
      expect(child).toEqual({ first_name: "Noah", last_name: "Martin" });
      await db.q(POSTGRES, "update public.families set status = 'lost' where id = $1", [familyId]);
      await db.q(POSTGRES, "update public.families set status_changed_at = now() - interval '2 years' where id = $1", [familyId]);
      await db.q(POSTGRES, "select private.anonymise_stale_families()");
      const [after] = await db.q(POSTGRES, "select first_name, last_name from public.children where family_id = $1", [familyId]);
      expect(after).toEqual({ first_name: "Anonymised", last_name: null });
    });

    it("refuses an enquiry without consent", async () => {
      await expect(db.submitEnquiry({ consent_share: false })).rejects.toThrow(/Consent is required/);
    });

    it("blocks skipping steps, records who moved it, and lets admins override", async () => {
      const familyId = await db.submitEnquiry();
      await expect(
        db.q(user(coordinator), "select public.set_family_status($1, 'converted')", [familyId]),
      ).rejects.toThrow(/cannot move from "new" to "converted"/);
      await db.q(user(coordinator), "select public.set_family_status($1, 'contacted')", [familyId]);
      const h = await db.one(POSTGRES, "select by, to_status from public.status_history where entity_id = $1 order by id desc limit 1", [familyId]);
      expect(h).toEqual({ by: coordinator, to_status: "contacted" });
      await db.q(user(admin), "update public.families set status = 'intro_done' where id = $1", [familyId]);
      expect(await db.familyStatus(familyId)).toBe("intro_done");
    });

    it("requires a reason to mark a family lost", async () => {
      const familyId = await db.submitEnquiry();
      await expect(db.q(user(coordinator), "select public.set_family_status($1, 'lost')", [familyId])).rejects.toThrow(/reason/);
      await db.q(user(coordinator), "select public.set_family_status($1, 'lost', 'Went elsewhere')", [familyId]);
      const f = await db.one(POSTGRES, "select status, status_reason from public.families where id = $1", [familyId]);
      expect(f).toEqual({ status: "lost", status_reason: "Went elsewhere" });
    });

    it("completes intake into Ready to match", async () => {
      const familyId = await db.submitEnquiry();
      await db.q(user(coordinator), "select public.complete_intake($1, 'ready_to_match', $2, 'Short note')", [
        familyId,
        JSON.stringify({ plan_manager: "PM Co" }),
      ]);
      expect(await db.familyStatus(familyId)).toBe("ready_to_match");
      const statuses = await db.q<{ to_status: string }>(
        POSTGRES,
        "select to_status from public.status_history where entity_id = $1 order by id",
        [familyId],
      );
      expect(statuses.map((s) => s.to_status)).toEqual(["new", "intake_done", "ready_to_match"]);
    });

    it("moves to Intake call booked from a Cal.com booking and schedules reminders", async () => {
      const familyId = await db.submitEnquiry();
      const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const [{ record_booking }] = await db.q<{ record_booking: string }>(
        SERVICE,
        "select public.record_booking('intake', $1, null, $2, 'uid-1')",
        [familyId, start],
      );
      expect(record_booking).toBe("intake booked");
      expect(await db.familyStatus(familyId)).toBe("intake_booked");
      const reminders = await db.q(POSTGRES, "select 1 from public.message_log where template = 'intake_reminder' and recipient_id = $1", [familyId]);
      expect(reminders).toHaveLength(2);
    });
  });

  describe("clinician privacy", () => {
    it("shows a clinician only a de-identified summary until they accept", async () => {
      const { clinicianId, userId } = await db.createActiveClinician({ name: "Priya" });
      const { familyId, childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [clinicianId]);

      expect(await db.q(user(userId), "select * from public.families where id = $1", [familyId])).toHaveLength(0);
      expect(await db.q(user(userId), "select * from public.children where id = $1", [childId])).toHaveLength(0);
      const [offer] = await db.q<Record<string, unknown>>(user(userId), "select * from public.get_my_offers()");
      expect(offer.suburb).toBe("Parramatta");
      expect(offer.child_age_years).toBe(5);
      const text = JSON.stringify(offer);
      expect(text).not.toContain("Sam Parent");
      expect(text).not.toContain("Alex");
      expect(text).not.toContain("0412");

      await db.q(user(userId), "select public.respond_to_offer($1, true)", [offer.match_id]);
      const families = await db.q(user(userId), "select parent_name, mobile from public.families where id = $1", [familyId]);
      expect(families).toEqual([{ parent_name: "Sam Parent", mobile: "+61412000111" }]);
    });

    it("never lets another clinician see an offer", async () => {
      const a = await db.createActiveClinician({ name: "A" });
      const b = await db.createActiveClinician({ name: "B" });
      const { childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId]);
      const [offer] = await db.q<{ match_id: string }>(user(a.userId), "select match_id from public.get_my_offers()");
      expect(await db.q(user(b.userId), "select * from public.get_my_offers() where match_id = $1", [offer.match_id])).toHaveLength(0);
      await expect(db.q(user(b.userId), "select public.respond_to_offer($1, true)", [offer.match_id])).rejects.toThrow(/Offer not found/);
    });

    it("lets clinicians edit their capacity but not their status or approval", async () => {
      const { clinicianId, userId } = await db.createActiveClinician();
      await db.q(user(userId), "update public.clinicians set capacity_new = 4, snoozed_until = '2030-01-01' where id = $1", [clinicianId]);
      await expect(db.q(user(userId), "update public.clinicians set status = 'paused', pause_reason = 'quality' where id = $1", [clinicianId])).rejects.toThrow(
        /ask the team/,
      );
      await expect(db.q(user(userId), "update public.clinicians set ndis_registered = false where id = $1", [clinicianId])).rejects.toThrow(/ask the team/);
    });

    it("puts clinician uploads in the verification queue and refuses licence copies", async () => {
      const { clinicianId, userId } = await db.createActiveClinician();
      const [row] = await db.q<{ status: string }>(
        user(userId),
        "insert into public.credentials (clinician_id, type, status, verified_at, file_path) values ($1, 'wwcc', 'verified', now(), 'x.pdf') returning status",
        [clinicianId],
      );
      expect(row.status).toBe("pending");
      await expect(
        db.q(user(userId), "insert into public.credentials (clinician_id, type) values ($1, 'drivers_licence')", [clinicianId]),
      ).rejects.toThrow(/sight it|check constraint|don't upload/i);
    });

    it("ends portal access when a clinician is off-boarded", async () => {
      const { clinicianId, userId } = await db.createActiveClinician();
      await db.q(user(coordinator), "select public.set_clinician_status($1, 'offboarded', null, 'Moving overseas')", [clinicianId]);
      expect(await db.q(user(userId), "select * from public.clinicians where id = $1", [clinicianId])).toHaveLength(0);
      expect(await db.q(POSTGRES, "select * from public.offboarding_checklists where clinician_id = $1", [clinicianId])).toHaveLength(1);
    });
  });

  describe("go-live gate", () => {
    it("won't activate a clinician until documents, agreement and clinical lead approval are in place", async () => {
      const { id } = await db.one<{ id: string }>(
        SERVICE,
        `select public.submit_application($1) as id`,
        [JSON.stringify({ name: "New Person", email: "new.person@example.com", mobile: "+61400111222", profession: "occupational_therapist", experience_years: 3, suburb: "Ryde", postcode: "2112" })],
      );
      await db.q(user(coordinator), "select public.set_clinician_status($1, 'documents_requested')", [id]);
      await db.q(POSTGRES, "update public.clinicians set status = 'documents_verified' where id = $1", [id]).catch(() => undefined);
      const gaps = await db.one<{ gaps: string[] }>(user(coordinator), "select public.clinician_go_live_gaps($1) as gaps", [id]);
      expect(gaps.gaps).toEqual(
        expect.arrayContaining(["credential:ahpra", "credential:wwcc", "agreement", "clinical_lead_approval", "calcom_intro_url", "portal_account"]),
      );
      expect(gaps.gaps).not.toContain("credential:spa_cpsp");
    });

    it("rejects activation with gaps, even from an admin", async () => {
      const { clinicianId } = await db.createActiveClinician();
      await db.q(POSTGRES, "update public.clinicians set status = 'paused', pause_reason = 'quality' where id = $1", [clinicianId]);
      await db.q(POSTGRES, "update public.clinicians set clinical_lead_approved_at = null where id = $1", [clinicianId]);
      await expect(db.q(user(admin), "select public.set_clinician_status($1, 'active')", [clinicianId])).rejects.toThrow(
        /Not ready to go live: clinical_lead_approval/,
      );
    });

    it("only lets a clinical lead or admin approve a clinician", async () => {
      const { clinicianId } = await db.createActiveClinician();
      await expect(db.q(user(coordinator), "select public.approve_clinician($1)", [clinicianId])).rejects.toThrow(/clinical lead/);
      await db.q(user(lead), "select public.approve_clinician($1)", [clinicianId]);
    });
  });

  describe("clinician allocation", () => {
    it("allocates a clinician directly and emails the family and the clinician", async () => {
      const a = await db.createActiveClinician({ name: "Ava Allocated", capacity: 2 });
      const { familyId, childId } = await db.createReadyFamily();
      await db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId]);

      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "accepted" });
      expect(await db.familyStatus(familyId)).toBe("accepted");
      const [c] = await db.q<{ capacity_new: number }>(POSTGRES, "select capacity_new from public.clinicians where id = $1", [a.clinicianId]);
      expect(c.capacity_new).toBe(1);
      const sent = await db.q<{ template: string }>(
        POSTGRES,
        "select distinct template from public.message_log where template in ('match_confirmed', 'clinician_allocated') and (recipient_id = $1 or recipient_id = $2) order by template",
        [familyId, a.clinicianId],
      );
      expect(sent.map((m) => m.template)).toEqual(["clinician_allocated", "match_confirmed"]);
      // the clinician can now see the family
      expect(await db.q(user(a.userId), "select id from public.families where id = $1", [familyId])).toHaveLength(1);
    });

    it("changes the clinician, returning the place and telling the first clinician", async () => {
      const a = await db.createActiveClinician({ name: "First Pick", capacity: 2 });
      const b = await db.createActiveClinician({ name: "Second Pick", capacity: 2 });
      const { familyId, childId } = await db.createReadyFamily();
      await db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId]);
      await db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, b.clinicianId]);

      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "withdrawn", [b.clinicianId]: "accepted" });
      expect(await db.familyStatus(familyId)).toBe("accepted");
      const caps = await db.q<{ id: string; capacity_new: number }>(POSTGRES, "select id, capacity_new from public.clinicians where id = any($1)", [[a.clinicianId, b.clinicianId]]);
      expect(Object.fromEntries(caps.map((c) => [c.id, c.capacity_new]))).toEqual({ [a.clinicianId]: 2, [b.clinicianId]: 1 });
      const removed = await db.q(POSTGRES, "select 1 from public.message_log where template = 'allocation_removed' and recipient_id = $1", [a.clinicianId]);
      expect(removed).toHaveLength(1);
      await expect(db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, b.clinicianId])).rejects.toThrow(/already allocated/);
    });

    it("won't allocate before the sign-up call, to an inactive clinician, or by a clinician", async () => {
      const a = await db.createActiveClinician();
      const early = await db.submitEnquiry();
      await expect(db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [early, a.clinicianId])).rejects.toThrow(/sign-up call/);

      const { familyId } = await db.createReadyFamily();
      await expect(db.q(user(a.userId), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId])).rejects.toThrow();
      await db.q(POSTGRES, "update public.clinicians set status = 'paused', pause_reason = 'clinician_request' where id = $1", [a.clinicianId]);
      await expect(db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId])).rejects.toThrow(/active/);
    });

    it("needs a clinical lead to allocate a complex case", async () => {
      const a = await db.createActiveClinician();
      const { familyId } = await db.createReadyFamily({ complex: true });
      await expect(db.q(user(coordinator), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId])).rejects.toThrow(/clinical lead/);
      await db.q(user(lead), "select public.allocate_clinician($1, $2)", [familyId, a.clinicianId]);
      expect(await db.familyStatus(familyId)).toBe("accepted");
    });
  });

  describe("referral offers", () => {
    it("offers one clinician at a time and moves down the shortlist on decline and timeout", async () => {
      const a = await db.createActiveClinician({ name: "First" });
      const b = await db.createActiveClinician({ name: "Second" });
      const c = await db.createActiveClinician({ name: "Third" });
      const { familyId, childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId, b.clinicianId, c.clinicianId]);

      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "offered", [b.clinicianId]: "proposed", [c.clinicianId]: "proposed" });
      expect(await db.familyStatus(familyId)).toBe("offered");

      const [offerA] = await db.q<{ match_id: string }>(user(a.userId), "select match_id from public.get_my_offers()");
      await db.q(user(a.userId), "select public.respond_to_offer($1, false, 'Full this term')", [offerA.match_id]);
      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "declined", [b.clinicianId]: "offered", [c.clinicianId]: "proposed" });

      // B doesn't answer within the window
      await db.q(POSTGRES, "update public.matches set offer_expires_at = now() - interval '1 minute' where child_id = $1 and state = 'offered'", [childId]);
      await db.q(SERVICE, "select public.run_scheduled_jobs('offers')");
      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "declined", [b.clinicianId]: "timeout", [c.clinicianId]: "offered" });

      const [offerC] = await db.q<{ match_id: string }>(user(c.userId), "select match_id from public.get_my_offers()");
      await db.q(user(c.userId), "select public.respond_to_offer($1, false)", [offerC.match_id]);
      expect(await db.familyStatus(familyId)).toBe("ready_to_match");
      const alert = await db.q(POSTGRES, "select 1 from public.message_log where template = 'shortlist_exhausted' and payload->>'family_id' = $1", [familyId]);
      expect(alert.length).toBeGreaterThan(0);
    });

    it("sends an SMS nudge once after 24 hours", async () => {
      const a = await db.createActiveClinician();
      const { childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId]);
      await db.q(POSTGRES, "update public.matches set offered_at = now() - interval '25 hours' where child_id = $1", [childId]);
      await db.q(SERVICE, "select public.run_scheduled_jobs('offers')");
      await db.q(SERVICE, "select public.run_scheduled_jobs('offers')");
      const nudges = await db.q(POSTGRES, "select 1 from public.message_log where template = 'offer_nudge' and recipient_id = $1", [a.clinicianId]);
      expect(nudges).toHaveLength(1);
    });

    it("in parallel mode, the first to accept wins and the others are withdrawn", async () => {
      await db.q(POSTGRES, `update public.settings set value = '"parallel"' where key = 'offer_mode'`);
      try {
        const a = await db.createActiveClinician();
        const b = await db.createActiveClinician();
        const c = await db.createActiveClinician();
        const { familyId, childId } = await db.createReadyFamily();
        await db.shortlistAndApprove(coordinator, childId, [a.clinicianId, b.clinicianId, c.clinicianId]);
        expect(Object.values(await db.matchStates(childId))).toEqual(["offered", "offered", "offered"]);

        const [offerB] = await db.q<{ match_id: string }>(user(b.userId), "select match_id from public.get_my_offers()");
        const [offerA] = await db.q<{ match_id: string }>(user(a.userId), "select match_id from public.get_my_offers()");
        await db.q(user(b.userId), "select public.respond_to_offer($1, true)", [offerB.match_id]);
        await expect(db.q(user(a.userId), "select public.respond_to_offer($1, true)", [offerA.match_id])).rejects.toThrow(/no longer open/);

        expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "withdrawn", [b.clinicianId]: "accepted", [c.clinicianId]: "withdrawn" });
        expect(await db.familyStatus(familyId)).toBe("accepted");
        const cap = await db.one<{ capacity_new: number }>(POSTGRES, "select capacity_new from public.clinicians where id = $1", [b.clinicianId]);
        expect(cap.capacity_new).toBe(1);
        const msg = await db.one<{ payload: { calcom_intro_url: string } }>(
          POSTGRES,
          "select payload from public.message_log where template = 'match_confirmed' and recipient_id = $1 limit 1",
          [familyId],
        );
        expect(msg.payload.calcom_intro_url).toBe("https://cal.com/x/intro");
      } finally {
        await db.q(POSTGRES, `update public.settings set value = '"sequential"' where key = 'offer_mode'`);
      }
    });

    it("needs a clinical lead to approve a complex case", async () => {
      const a = await db.createActiveClinician();
      const { childId } = await db.createReadyFamily({ complex: true });
      await db.q(user(coordinator), "select public.propose_shortlist($1, $2)", [childId, JSON.stringify([{ clinician_id: a.clinicianId, rank: 1 }])]);
      await expect(db.q(user(coordinator), "select public.approve_shortlist($1)", [childId])).rejects.toThrow(/complex case/);
      await db.q(user(lead), "select public.approve_shortlist($1)", [childId]);
      expect(Object.values(await db.matchStates(childId))).toEqual(["offered"]);
    });

    it("skips a clinician who became unavailable after the shortlist was approved", async () => {
      const a = await db.createActiveClinician();
      const b = await db.createActiveClinician();
      const { childId } = await db.createReadyFamily();
      await db.q(POSTGRES, "update public.clinicians set capacity_new = 0 where id = $1", [a.clinicianId]);
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId, b.clinicianId]);
      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "withdrawn", [b.clinicianId]: "offered" });
    });

    it("runs through intro call and first-session confirmation by one-click link", async () => {
      const a = await db.createActiveClinician();
      const { familyId, childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId]);
      const [offer] = await db.q<{ match_id: string }>(user(a.userId), "select match_id from public.get_my_offers()");
      await db.q(user(a.userId), "select public.respond_to_offer($1, true)", [offer.match_id]);
      await db.q(SERVICE, "select public.record_booking('intro', $1, null, now() + interval '2 days', 'intro-1')", [offer.match_id]);
      expect(await db.familyStatus(familyId)).toBe("intro_booked");
      await db.q(user(a.userId), "select public.record_intro_outcome($1, 'going_ahead')", [offer.match_id]);
      expect(await db.familyStatus(familyId)).toBe("intro_done");

      const msg = await db.one<{ payload: { token: string } }>(
        POSTGRES,
        "select payload from public.message_log where template = 'first_session_check' and payload->>'match_id' = $1",
        [offer.match_id],
      );
      await db.q(SERVICE, "select public.confirm_first_session_by_token($1, current_date + 3)", [msg.payload.token]);
      expect(await db.familyStatus(familyId)).toBe("converted");
      await expect(db.q(SERVICE, "select public.confirm_first_session_by_token($1, current_date + 3)", [msg.payload.token])).rejects.toThrow(
        /already been used/,
      );
      const followUps = await db.q<{ template: string }>(
        POSTGRES,
        "select distinct template from public.message_log where payload->>'match_id' = $1 and template in ('satisfaction_check', 'clinician_checkin')",
        [offer.match_id],
      );
      expect(followUps).toHaveLength(2);
    });

    it("returns a family to Ready to match and frees capacity when the intro doesn't go ahead", async () => {
      const a = await db.createActiveClinician({ capacity: 1 });
      const { familyId, childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId]);
      const [offer] = await db.q<{ match_id: string }>(user(a.userId), "select match_id from public.get_my_offers()");
      await db.q(user(a.userId), "select public.respond_to_offer($1, true)", [offer.match_id]);
      await db.q(user(a.userId), "select public.record_intro_outcome($1, 'not_going_ahead', 'Family wanted weekends')", [offer.match_id]);
      expect(await db.familyStatus(familyId)).toBe("ready_to_match");
      const cap = await db.one<{ capacity_new: number }>(POSTGRES, "select capacity_new from public.clinicians where id = $1", [a.clinicianId]);
      expect(cap.capacity_new).toBe(1);
      expect(await db.q(user(a.userId), "select * from public.families where id = $1", [familyId])).toHaveLength(0);
    });
  });

  describe("credential automation", () => {
    it("pauses on expiry, withdraws open offers, then reactivates once the new document is verified", async () => {
      const a = await db.createActiveClinician();
      const { childId } = await db.createReadyFamily();
      await db.shortlistAndApprove(coordinator, childId, [a.clinicianId]);

      await db.q(POSTGRES, "update public.credentials set expires_at = current_date - 1 where clinician_id = $1 and type = 'wwcc'", [a.clinicianId]);
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");

      const c = await db.one(POSTGRES, "select status, pause_reason from public.clinicians where id = $1", [a.clinicianId]);
      expect(c).toEqual({ status: "paused", pause_reason: "credentials" });
      expect(await db.matchStates(childId)).toEqual({ [a.clinicianId]: "withdrawn" });

      const [upload] = await db.q<{ id: string }>(
        user(a.userId),
        "insert into public.credentials (clinician_id, type, expires_at, file_path) values ($1, 'wwcc', '2031-01-01', 'x/wwcc.pdf') returning id",
        [a.clinicianId],
      );
      await db.q(user(coordinator), "select public.verify_credential($1, true)", [upload.id]);
      const after = await db.one(POSTGRES, "select status, pause_reason from public.clinicians where id = $1", [a.clinicianId]);
      expect(after).toEqual({ status: "active", pause_reason: null });
      const old = await db.one<{ status: string }>(
        POSTGRES,
        "select status from public.credentials where clinician_id = $1 and type = 'wwcc' and id <> $2",
        [a.clinicianId, upload.id],
      );
      expect(old.status).toBe("superseded");
    });

    it("sends each reminder band once, and alerts staff at 7 days", async () => {
      const a = await db.createActiveClinician();
      const set = (days: number) =>
        db.q(POSTGRES, "update public.credentials set expires_at = current_date + $2::int where clinician_id = $1 and type = 'pi_insurance'", [
          a.clinicianId,
          days,
        ]);
      const count = async (template: string) =>
        (
          await db.q(POSTGRES, "select 1 from public.message_log where template = $1 and (recipient_id = $2 or payload->>'clinician_id' = $2::text)", [
            template,
            a.clinicianId,
          ])
        ).length;

      await set(59);
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");
      expect(await count("credential_expiring")).toBe(2); // email + SMS, once
      await set(29);
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");
      expect(await count("credential_expiring")).toBe(4);
      expect(await count("credential_expiring_staff")).toBe(0);
      await set(6);
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");
      expect(await count("credential_expiring")).toBe(6);
      expect(await count("credential_expiring_staff")).toBe(2);
    });

    it("pauses an active clinician with any missing required document", async () => {
      const a = await db.createActiveClinician();
      await db.q(POSTGRES, "update public.credentials set status = 'superseded' where clinician_id = $1 and type = 'drivers_licence'", [a.clinicianId]);
      await db.q(SERVICE, "select public.run_scheduled_jobs('daily')");
      const c = await db.one(POSTGRES, "select status, pause_reason from public.clinicians where id = $1", [a.clinicianId]);
      expect(c).toEqual({ status: "paused", pause_reason: "credentials" });
    });

    it("needs an expiry date to verify an expiring document", async () => {
      const a = await db.createActiveClinician();
      const [upload] = await db.q<{ id: string }>(
        user(a.userId),
        "insert into public.credentials (clinician_id, type, file_path) values ($1, 'pl_insurance', 'x/pl.pdf') returning id",
        [a.clinicianId],
      );
      await expect(db.q(user(coordinator), "select public.verify_credential($1, true)", [upload.id])).rejects.toThrow(/expiry date/);
      await db.q(user(coordinator), "select public.verify_credential($1, true, null, '2031-06-30')", [upload.id]);
    });

    it("pauses a clinician whose ABN is no longer active", async () => {
      const a = await db.createActiveClinician();
      await db.q(POSTGRES, "update public.credentials set number = '51824753556' where clinician_id = $1 and type = 'abn'", [a.clinicianId]);
      await db.q(SERVICE, "select public.record_abn_check($1, '51824753556', false, 'Old Pty Ltd')", [a.clinicianId]);
      const c = await db.one(POSTGRES, "select status from public.clinicians where id = $1", [a.clinicianId]);
      expect(c.status).toBe("paused");
    });

    it("alerts coordinators to re-check the waitlist when capacity frees up", async () => {
      const a = await db.createActiveClinician({ capacity: 0 });
      const { familyId } = await db.createReadyFamily();
      await db.q(user(coordinator), "select public.set_waitlist($1, 'No clinician within 10 km', '{area:2150}')", [familyId]);
      await db.q(user(a.userId), "update public.clinicians set capacity_new = 2 where id = $1", [a.clinicianId]);
      const alerts = await db.q(POSTGRES, "select 1 from public.message_log where template = 'waitlist_recheck' and payload->>'clinician_id' = $1", [
        a.clinicianId,
      ]);
      expect(alerts.length).toBeGreaterThan(0);
      const f = await db.one(POSTGRES, "select status, waitlist_reason, waitlist_codes from public.families where id = $1", [familyId]);
      expect(f).toEqual({ status: "waitlist", waitlist_reason: "No clinician within 10 km", waitlist_codes: ["area:2150"] });
    });
  });

  describe("outbox", () => {
    it("claims due messages once and retries failures with backoff", async () => {
      await db.q(POSTGRES, "update public.message_log set status = 'sent'");
      await db.submitEnquiry();
      const first = await db.q<{ id: string }>(SERVICE, "select id from public.claim_messages(100)");
      const second = await db.q(SERVICE, "select id from public.claim_messages(100)");
      expect(first.length).toBe(4);
      expect(second.length).toBe(0);
      await db.q(SERVICE, "select public.complete_message($1, 'failed', 'Timeout')", [first[0].id]);
      const row = await db.one<{ status: string; due_later: boolean }>(
        POSTGRES,
        "select status, scheduled_for > now() as due_later from public.message_log where id = $1",
        [first[0].id],
      );
      expect(row).toEqual({ status: "queued", due_later: true });
    });
  });
});
