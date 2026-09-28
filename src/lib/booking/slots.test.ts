import { describe, expect, it } from "vitest";
import { availableSlots, hostSlots, localDate, pickHost, zonedTimeToUtc, type HostSchedule } from "./slots";
import { makeLinkToken, readLinkToken } from "./links";

const MEL = "Australia/Melbourne";
const BNE = "Australia/Brisbane";

function host(over: Partial<HostSchedule> = {}): HostSchedule {
  return { hostId: "h1", timezone: MEL, windows: [{ day: 2, start: "15:00", end: "16:00" }], timeOff: [], busy: [], ...over };
}

// Monday 5 October 2026, 9am in Melbourne (daylight saving started the day before: UTC+11).
const NOW = zonedTimeToUtc("2026-10-05", "09:00", MEL);
const opts = { minutes: 15, now: NOW, minNoticeHours: 12, horizonDays: 8 };
const iso = (ms: number) => new Date(ms).toISOString();

describe("time zones", () => {
  it("turns local wall-clock times into UTC, across daylight saving", () => {
    expect(iso(zonedTimeToUtc("2026-10-06", "15:00", MEL))).toBe("2026-10-06T04:00:00.000Z"); // AEDT, UTC+11
    expect(iso(zonedTimeToUtc("2026-09-29", "15:00", MEL))).toBe("2026-09-29T05:00:00.000Z"); // AEST, UTC+10
    expect(iso(zonedTimeToUtc("2026-10-06", "15:00", BNE))).toBe("2026-10-06T05:00:00.000Z"); // Queensland: no daylight saving
    expect(localDate(Date.parse("2026-10-05T14:30:00Z"), MEL)).toBe("2026-10-06");
  });
});

describe("free times", () => {
  it("offers the weekly hours on a grid of the call length", () => {
    const slots = hostSlots(host(), opts).map(iso);
    expect(slots.slice(0, 4)).toEqual(["2026-10-06T04:00:00.000Z", "2026-10-06T04:15:00.000Z", "2026-10-06T04:30:00.000Z", "2026-10-06T04:45:00.000Z"]);
    expect(slots).toHaveLength(8); // this Tuesday and next
  });

  it("leaves out times inside the minimum notice, booked times and days off", () => {
    const tuesday3pm = zonedTimeToUtc("2026-10-06", "15:00", MEL);
    const late = hostSlots(host(), { ...opts, minNoticeHours: 30.2 }).map(iso); // Tue 3:12pm
    expect(late[0]).toBe("2026-10-06T04:15:00.000Z");
    const busy = hostSlots(host({ busy: [{ start: tuesday3pm, end: tuesday3pm + 30 * 60_000 }] }), opts).map(iso);
    expect(busy.slice(0, 2)).toEqual(["2026-10-06T04:30:00.000Z", "2026-10-06T04:45:00.000Z"]);
    const away = hostSlots(host({ timeOff: [{ starts_on: "2026-10-06", ends_on: "2026-10-06" }] }), opts);
    expect(away).toHaveLength(4);
  });

  it("merges the team's times and spreads calls to whoever has fewest", () => {
    const a = host({ hostId: "a" });
    const b = host({ hostId: "b", windows: [{ day: 2, start: "15:30", end: "16:30" }] });
    const slots = availableSlots([a, b], { ...opts, horizonDays: 1 });
    expect(slots.map((s) => [iso(s.start), s.hostIds])).toEqual([
      ["2026-10-06T04:00:00.000Z", ["a"]],
      ["2026-10-06T04:15:00.000Z", ["a"]],
      ["2026-10-06T04:30:00.000Z", ["a", "b"]],
      ["2026-10-06T04:45:00.000Z", ["a", "b"]],
      ["2026-10-06T05:00:00.000Z", ["b"]],
      ["2026-10-06T05:15:00.000Z", ["b"]],
    ]);
    expect(pickHost(["a", "b"], new Map([["a", 3], ["b", 1]]))).toBe("b");
  });
});

describe("signed links", () => {
  const id = "0472d4db-d937-40dc-9de9-3bee70ae239b";
  it("reads back what it signed, and rejects anything altered", () => {
    const t = makeLinkToken("secret", "signup_call", id);
    expect(readLinkToken("secret", t)).toEqual({ kind: "signup_call", id, version: null });
    expect(readLinkToken("other-secret", t)).toBeNull();
    expect(readLinkToken("secret", t.replace("s.", "i."))).toBeNull();
    const a = makeLinkToken("secret", "availability", id, 3);
    expect(readLinkToken("secret", a)).toEqual({ kind: "availability", id, version: 3 });
    expect(readLinkToken("secret", a.replace(".3.", ".4."))).toBeNull();
  });
});
