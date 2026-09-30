import { describe, expect, it } from "vitest";
import { badgeLabel, REASONS_BY_VIA, viaOf } from "./labels";

describe("badgeLabel", () => {
  it("says how it was chosen and where it ranked, for new rows", () => {
    expect(badgeLabel({ reason: "picked", rank: 1, shortlistSize: 8 })).toBe("Picked · #1 of 8");
    expect(badgeLabel({ reason: "spun", rank: 3, shortlistSize: 5 })).toBe("Spun · #3 of 5");
  });

  it("maps legacy engine verdicts when there is no rank", () => {
    expect(badgeLabel({ reason: "confident", rank: null, shortlistSize: null })).toBe("Top pick");
    expect(badgeLabel({ reason: "fair_spin", rank: null, shortlistSize: null })).toBe("Spun");
    expect(badgeLabel({ reason: "only_option", rank: null, shortlistSize: null })).toBe("Only option");
  });

  it("falls back gracefully for a reason it doesn't know", () => {
    expect(badgeLabel({ reason: "something_new", rank: null, shortlistSize: null })).toBe("Decided");
  });

  it("uses the rank wording even when the old reason was a legacy value", () => {
    expect(badgeLabel({ reason: "fair_spin", rank: 2, shortlistSize: 4 })).toBe("Spun · #2 of 4");
  });
});

describe("viaOf / REASONS_BY_VIA", () => {
  it("classifies new and legacy reasons", () => {
    expect(viaOf("picked")).toBe("picked");
    expect(viaOf("confident")).toBe("picked");
    expect(viaOf("only_option")).toBe("picked");
    expect(viaOf("spun")).toBe("spun");
    expect(viaOf("fair_spin")).toBe("spun");
  });

  it("agrees with the SQL reason lists the filter chips use", () => {
    for (const reason of REASONS_BY_VIA.picked) expect(viaOf(reason)).toBe("picked");
    for (const reason of REASONS_BY_VIA.spun) expect(viaOf(reason)).toBe("spun");
  });
});
