import { describe, expect, it } from "vitest";
import { filtersToSearch, hasActiveFilters, historyQuerySchema, parseHistoryFilters } from "./filters";

describe("parseHistoryFilters", () => {
  it("reads valid params", () => {
    expect(parseHistoryFilters({ q: " biryani ", cuisine: "Indian", via: "spun", tab: "favourites" })).toEqual({
      q: "biryani",
      cuisine: "Indian",
      via: "spun",
      tab: "favourites",
    });
  });

  it("defaults to no filtering", () => {
    expect(parseHistoryFilters({})).toEqual({ q: "", cuisine: null, via: null, tab: "all" });
  });

  it("ignores unrecognised values from a hand-edited URL", () => {
    const f = parseHistoryFilters({ cuisine: "'; drop table decisions;--", via: "nope", tab: "x" });
    expect(f).toEqual({ q: "", cuisine: null, via: null, tab: "all" });
  });

  it("takes the first value of a repeated param and caps the search length", () => {
    expect(parseHistoryFilters({ cuisine: ["Thai", "Indian"] }).cuisine).toBe("Thai");
    expect(parseHistoryFilters({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("hasActiveFilters / filtersToSearch", () => {
  it("counts search, cuisine and via - but not the tab - as narrowing", () => {
    expect(hasActiveFilters({ q: "", cuisine: null, via: null, tab: "favourites" })).toBe(false);
    expect(hasActiveFilters({ q: "a", cuisine: null, via: null, tab: "all" })).toBe(true);
    expect(hasActiveFilters({ q: "", cuisine: "Thai", via: null, tab: "all" })).toBe(true);
    expect(hasActiveFilters({ q: "", cuisine: null, via: "picked", tab: "all" })).toBe(true);
  });

  it("round-trips through the URL", () => {
    const f = { q: "nasi lemak", cuisine: "Malay", via: "picked" as const, tab: "favourites" as const };
    const search = filtersToSearch(f);
    expect(parseHistoryFilters(Object.fromEntries(new URLSearchParams(search)))).toEqual(f);
  });

  it("is empty when nothing is set", () => {
    expect(filtersToSearch({ q: "", cuisine: null, via: null, tab: "all" })).toBe("");
  });
});

describe("historyQuerySchema", () => {
  const base = { q: "", cuisine: null, via: null, favouritesOnly: false, excludeFavourites: false, cursor: null };

  it("accepts a well-formed query", () => {
    expect(historyQuerySchema.safeParse({ ...base, cuisine: "Indian", via: "spun" }).success).toBe(true);
  });

  it("rejects an unknown cuisine or an oversized search", () => {
    expect(historyQuerySchema.safeParse({ ...base, cuisine: "Klingon" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ ...base, q: "x".repeat(81) }).success).toBe(false);
  });
});
