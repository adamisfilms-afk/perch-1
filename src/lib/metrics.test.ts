import { describe, expect, it } from "vitest";
import { breakdown, check, fmtDays, fmtPct, median, pct } from "./metrics";

describe("dashboard metrics", () => {
  it("takes the median of odd and even lists, and nothing for no data", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("formats percentages and days, and leaves missing data unjudged", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBeNull();
    expect(fmtPct(null)).toBe("–");
    expect(fmtDays(1.26, "days")).toBe("1.3 days");
    expect(check(null, (v) => v > 1)).toBeNull();
    expect(check(2, (v) => v > 1)).toBe(true);
  });

  it("groups enquiries with their conversions, biggest first", () => {
    const rows = [
      { status: "converted", source: "GP" },
      { status: "new", source: "GP" },
      { status: "converted", source: "School" },
    ];
    expect(breakdown(rows, (r) => r.source)).toEqual([
      ["GP", { total: 2, converted: 1 }],
      ["School", { total: 1, converted: 1 }],
    ]);
  });
});
