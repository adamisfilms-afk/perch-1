import { describe, expect, it } from "vitest";
import { CLINICIAN_STATUSES, CLINICIAN_TRANSITIONS, clinicianMoves } from "./domain";

describe("clinician status moves", () => {
  const values = (status: (typeof CLINICIAN_STATUSES)[number], submitted: boolean, lead = true) =>
    clinicianMoves({ status, application_submitted_at: submitted ? "2026-10-01T00:00:00Z" : null }, lead).map((m) => m.value);

  it("follows the live workflow", () => {
    expect(values("applied", false)).toEqual(["screening", "offboarded"]);
    expect(values("applied", true)).toEqual(["screening", "ready_intake", "offboarded"]);
    expect(values("screening", true)).toEqual(["applied", "ready_intake", "offboarded"]);
    expect(values("screening", true, false)).toEqual(["applied", "offboarded"]); // only a clinical lead or admin records the call
    expect(values("active", true)).toEqual(["paused", "offboarded"]);
    expect(values("paused", true)).toEqual(["active", "offboarded"]);
    expect(values("offboarded", true)).toEqual([]);
    // a clinician left on an old recruitment step can be brought back into the workflow
    expect(values("documents_requested", false)).toEqual(["applied", "screening", "offboarded"]);
  });

  it("only offers moves the database allows", () => {
    for (const status of CLINICIAN_STATUSES) {
      for (const v of values(status, true)) {
        const to = v === "ready_intake" ? "active" : v;
        expect(CLINICIAN_TRANSITIONS[status]).toContain(to);
      }
    }
  });
});
