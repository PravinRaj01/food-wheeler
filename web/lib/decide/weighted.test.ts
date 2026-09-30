import { describe, expect, it } from "vitest";
import { pickWeighted, SHORTLIST_SIZE, topWeights } from "./weighted";
import type { RankingRow } from "./types";

const row = (id: string, probability: number): RankingRow => ({ id, name: id.toUpperCase(), probability, color: "#fff" });

describe("topWeights", () => {
  it("keeps only the top few places, in rank order", () => {
    const ranking = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => row(id, 0.3 - i * 0.03));
    expect(topWeights(ranking).map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(topWeights(ranking, 3)).toHaveLength(3);
    expect(SHORTLIST_SIZE).toBe(5);
  });

  it("renormalizes to a whole wheel - the engine's raw scores only add up across ALL candidates", () => {
    const slices = topWeights([row("a", 0.3), row("b", 0.2), row("c", 0.1)]);
    expect(slices.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1);
  });

  it("gives a better match a bigger slice", () => {
    const [a, b, c] = topWeights([row("a", 0.5), row("b", 0.3), row("c", 0.2)]);
    expect(a.weight).toBeGreaterThan(b.weight);
    expect(b.weight).toBeGreaterThan(c.weight);
  });

  it("never lets a slice shrink to nothing", () => {
    const slices = topWeights([row("a", 0.9), row("b", 0.09), row("c", 0.0001)]);
    expect(Math.min(...slices.map((s) => s.weight))).toBeGreaterThan(0.04);
    expect(slices.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1);
  });

  it("falls back to an even wheel when every score is zero", () => {
    const slices = topWeights([row("a", 0), row("b", 0)]);
    expect(slices[0].weight).toBeCloseTo(0.5);
  });

  it("returns nothing for an empty ranking", () => {
    expect(topWeights([])).toEqual([]);
  });
});

describe("pickWeighted", () => {
  const slices = [
    { id: "a", weight: 0.6 },
    { id: "b", weight: 0.3 },
    { id: "c", weight: 0.1 },
  ];

  it("maps a draw onto the slice it falls in", () => {
    expect(pickWeighted(slices, () => 0)).toBe("a");
    expect(pickWeighted(slices, () => 0.59)).toBe("a");
    expect(pickWeighted(slices, () => 0.61)).toBe("b");
    expect(pickWeighted(slices, () => 0.95)).toBe("c");
    expect(pickWeighted(slices, () => 0.999999)).toBe("c");
  });

  it("follows the slice sizes over many draws - and does NOT always pick the favourite", () => {
    // A seeded LCG so the tolerance check is reproducible.
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const trials = 10_000;
    for (let i = 0; i < trials; i++) counts[pickWeighted(slices, random)]++;
    expect(counts.a / trials).toBeCloseTo(0.6, 1);
    expect(counts.b / trials).toBeCloseTo(0.3, 1);
    expect(counts.c / trials).toBeCloseTo(0.1, 1);
    expect(counts.b).toBeGreaterThan(0);
    expect(counts.c).toBeGreaterThan(0);
  });
});
