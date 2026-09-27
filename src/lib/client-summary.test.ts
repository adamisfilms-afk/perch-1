import { describe, expect, it } from "vitest";
import {
  computeKpis,
  filterClients,
  formatElapsed,
  formatSignUpDate,
  parseKpiTargets,
  parseStepTargets,
  sortClients,
  splitDaysHours,
  toClientRow,
} from "./client-summary";

const NOW = Date.parse("2026-09-27T02:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function family(over: Partial<Parameters<typeof toClientRow>[0]> = {}) {
  return {
    id: crypto.randomUUID(),
    parent_name: "Olivia Martin",
    status: "new" as const,
    status_changed_at: hoursAgo(7 + 5 / 60),
    created_at: hoursAgo(10),
    state: "NSW",
    suburb: "Westmead",
    funding_type: "private" as const,
    children: [{ first_name: "Noah" }],
    ...over,
  };
}

describe("client rows", () => {
  it("counts time since the previous step and flags it against the step's target", () => {
    const r = toClientRow(family({ status_changed_at: hoursAgo(44.1) }), { new: 24 }, NOW);
    expect(formatElapsed(r.elapsedHours)).toBe("44h 6m");
    expect(r.overdue).toBe(true);
    expect(toClientRow(family(), { new: 24 }, NOW).overdue).toBe(false);
  });

  it("stops the clock once a client is active or has left", () => {
    for (const status of ["converted", "lost", "withdrawn"] as const) {
      const r = toClientRow(family({ status, status_changed_at: hoursAgo(500) }), { new: 24 }, NOW);
      expect(r.elapsedHours).toBeNull();
      expect(r.overdue).toBe(false);
      expect(formatElapsed(r.elapsedHours)).toBe("–");
    }
  });

  it("formats sign-up dates in Sydney time", () => {
    expect(formatSignUpDate("2026-09-26T15:00:00Z")).toBe("27-9-2026");
  });

  it("sorts by status in funnel order, newest sign-up first within a status", () => {
    const rows = [
      toClientRow(family({ id: "a", status: "converted" }), {}, NOW),
      toClientRow(family({ id: "b", status: "contacted" }), {}, NOW),
      toClientRow(family({ id: "c", status: "new", created_at: hoursAgo(50) }), {}, NOW),
      toClientRow(family({ id: "d", status: "new", created_at: hoursAgo(5) }), {}, NOW),
    ];
    expect(sortClients(rows, "status", "asc").map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
    expect(sortClients(rows, "status", "desc").map((r) => r.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("keeps blanks last whichever way elapsed time is sorted", () => {
    const rows = [
      toClientRow(family({ id: "active", status: "converted" }), {}, NOW),
      toClientRow(family({ id: "short", status_changed_at: hoursAgo(1) }), {}, NOW),
      toClientRow(family({ id: "long", status_changed_at: hoursAgo(90) }), {}, NOW),
    ];
    expect(sortClients(rows, "elapsed", "desc").map((r) => r.id)).toEqual(["long", "short", "active"]);
    expect(sortClients(rows, "elapsed", "asc").map((r) => r.id)).toEqual(["short", "long", "active"]);
  });

  it("searches names, children, places and funding", () => {
    const rows = [toClientRow(family({ id: "a" }), {}, NOW), toClientRow(family({ id: "b", parent_name: "Jack Brown", children: [{ first_name: "Mason" }], suburb: "Cabramatta", funding_type: "ndis_self_managed" }), {}, NOW)];
    expect(filterClients(rows, "mason").map((r) => r.id)).toEqual(["b"]);
    expect(filterClients(rows, "ndis sm").map((r) => r.id)).toEqual(["b"]);
    expect(filterClients(rows, "  ").length).toBe(2);
  });
});

describe("targets", () => {
  it("ignores blank, zero and non-numeric targets", () => {
    expect(parseStepTargets({ new: 24, contacted: 0, intake_booked: "x", converted: 10 })).toEqual({ new: 24 });
    expect(parseKpiTargets({ active_rate_pct: 50, total_clients: null })).toEqual({
      total_clients: null,
      active_rate_pct: 50,
      signup_to_session_days: null,
      new_signups_7d: null,
    });
  });
});

describe("KPIs", () => {
  it("works out totals, active share, sign-up to session and weekly sign-ups", () => {
    const families = [
      { created_at: hoursAgo(24), status: "new" as const },
      { created_at: hoursAgo(24 * 3), status: "contacted" as const },
      { created_at: hoursAgo(24 * 10), status: "converted" as const },
      { created_at: hoursAgo(24 * 200), status: "converted" as const },
    ];
    const k = computeKpis(families, [{ created_at: "2026-09-10T00:00:00+10:00", first_session_at: "2026-09-17" }], NOW);
    expect(k.total).toBe(4);
    expect(k.active).toBe(2);
    expect(k.activeRatePct).toBe(50);
    expect(k.signupToSessionHours).toBe(7 * 24);
    expect(k.newSignups7d).toBe(2);
    expect(k.newSignupsPrev7d).toBe(1);
    expect(k.totalSeries).toHaveLength(90);
    expect(k.totalSeries.at(-1)).toBe(4);
    expect(k.newSignupsSeries.at(-1)).toBe(2);
  });

  it("has no averages when there's no data", () => {
    const k = computeKpis([], [], NOW);
    expect(k.activeRatePct).toBeNull();
    expect(k.signupToSessionHours).toBeNull();
  });

  it("splits hours into days and hours", () => {
    expect(splitDaysHours(178)).toEqual({ days: 7, hours: 10 });
  });
});
