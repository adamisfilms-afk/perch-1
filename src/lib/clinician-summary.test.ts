import { describe, expect, it } from "vitest";
import { computeKpis } from "./client-summary";
import {
  filterClinicians,
  firstSessionsByClinician,
  outOfDateCount,
  parseStageTargets,
  sortClinicians,
  stageOf,
  toClinicianRow,
  type ClinicianSource,
} from "./clinician-summary";

const NOW = Date.parse("2026-09-27T12:00:00+10:00");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function clinician(over: Partial<ClinicianSource> = {}): ClinicianSource {
  return {
    id: "c1",
    name: "Olivia Hart",
    email: "olivia@example.com",
    profession: "speech_pathologist",
    status: "applied",
    status_changed_at: hoursAgo(50),
    created_at: hoursAgo(50),
    application_submitted_at: null,
    suburb: "Carlton",
    postcode: "3053",
    ...over,
  };
}

describe("clinician stages", () => {
  it("follows sign-up, application, intake call, ready and active", () => {
    expect(stageOf(clinician(), 0)).toBe("new");
    expect(stageOf(clinician({ application_submitted_at: hoursAgo(2) }), 0)).toBe("application_complete");
    expect(stageOf(clinician({ status: "screening", application_submitted_at: hoursAgo(2) }), 0)).toBe("intake_booked");
    expect(stageOf(clinician({ status: "active" }), 0)).toBe("ready");
    expect(stageOf(clinician({ status: "active" }), 2)).toBe("active");
    expect(stageOf(clinician({ status: "paused" }), 2)).toBe("paused");
  });

  it("times each step from when it started and flags it against the target", () => {
    const targets = parseStageTargets({ new: 24, application_complete: 72, ready: 5 });
    expect(targets).toEqual({ new: 24, application_complete: 72 });
    const late = toClinicianRow(clinician(), 0, targets, NOW);
    expect(Math.round(late.elapsedHours!)).toBe(50);
    expect(late.overdue).toBe(true);
    const submitted = toClinicianRow(clinician({ application_submitted_at: hoursAgo(3) }), 0, targets, NOW);
    expect(Math.round(submitted.elapsedHours!)).toBe(3);
    expect(submitted.overdue).toBe(false);
    const active = toClinicianRow(clinician({ status: "active" }), 1, targets, NOW);
    expect(active.elapsedHours).toBeNull();
    expect(active.state).toBe("VIC");
  });

  it("sorts by stage in onboarding order and searches by name, email and stage", () => {
    const rows = [
      toClinicianRow(clinician({ id: "a", status: "active" }), 1, {}, NOW),
      toClinicianRow(clinician({ id: "b", name: "Eve Cally", email: "eve@example.com" }), 0, {}, NOW),
      toClinicianRow(clinician({ id: "c", status: "active" }), 0, {}, NOW),
    ];
    expect(sortClinicians(rows, "stage", "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(filterClinicians(rows, "eve@").map((r) => r.id)).toEqual(["b"]);
    expect(filterClinicians(rows, "ready").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("clinician KPIs", () => {
  it("counts clinicians with an active client, and times sign-up to their first client's first session", () => {
    const list = [
      { id: "a", created_at: "2026-09-01T00:00:00+10:00" },
      { id: "b", created_at: "2026-09-10T00:00:00+10:00" },
    ];
    const pairs = firstSessionsByClinician(list, [
      { clinician_id: "a", first_session_at: "2026-09-21" },
      { clinician_id: "a", first_session_at: "2026-09-11" },
    ]);
    expect(pairs).toEqual([{ created_at: "2026-09-01T00:00:00+10:00", first_session_at: "2026-09-11" }]);
    const k = computeKpis(list, pairs, NOW, (c) => c.id === "a");
    expect(k.total).toBe(2);
    expect(k.active).toBe(1);
    expect(k.activeRatePct).toBe(50);
    expect(k.signupToSessionHours).toBe(10 * 24);
  });
});

describe("documents out of date", () => {
  it("counts the newest document of each type that has expired or passed its expiry date", () => {
    const docs = [
      { type: "wwcc", status: "verified", expires_at: "2026-09-01" }, // passed, not yet marked expired
      { type: "wwcc", status: "expired", expires_at: "2025-01-01" }, // older copy: ignored
      { type: "pi_insurance", status: "expired", expires_at: "2026-08-01" },
      { type: "ahpra", status: "verified", expires_at: "2027-01-01" },
      { type: "abn", status: "superseded", expires_at: null },
      { type: "cv", status: "pending", expires_at: null },
    ];
    expect(outOfDateCount(docs, "2026-09-27")).toBe(2);
  });
});
