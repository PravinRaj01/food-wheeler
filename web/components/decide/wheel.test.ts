import { describe, expect, it } from "vitest";
import { computeLandingRotation, sliceUnderNeedle, slicesFromRanking } from "./wheel";
import type { RankingRow } from "@/lib/decide/types";

describe("computeLandingRotation / sliceUnderNeedle", () => {
  it("always lands the needle back on the winning slice, across 1000 random jitter samples and slice counts", () => {
    for (let trial = 0; trial < 1000; trial++) {
      const sliceCount = 2 + (trial % 7); // 2..8 slices, matching the app's real wheel sizes
      const winnerIndex = trial % sliceCount;
      // A fixed pseudo-random sequence per trial so failures are reproducible,
      // covering the full [0, 1) jitter range rather than relying on the
      // real Math.random - full coverage is the point of a property test.
      const random = () => (trial * 2654435761) % 1000 / 1000;

      const rotation = computeLandingRotation(winnerIndex, sliceCount, random);
      const landedIndex = sliceUnderNeedle(rotation, sliceCount);

      expect(landedIndex).toBe(winnerIndex);
    }
  });

  it("stays inside the slice even at the extreme ends of the jitter range", () => {
    for (const random of [() => 0, () => 0.999999]) {
      for (let sliceCount = 2; sliceCount <= 8; sliceCount++) {
        for (let winnerIndex = 0; winnerIndex < sliceCount; winnerIndex++) {
          const rotation = computeLandingRotation(winnerIndex, sliceCount, random);
          expect(sliceUnderNeedle(rotation, sliceCount)).toBe(winnerIndex);
        }
      }
    }
  });

  it("adding extra full turns never changes which slice the needle lands on", () => {
    const random = () => 0.5;
    const rotation0 = computeLandingRotation(1, 6, random, 0);
    const rotation5 = computeLandingRotation(1, 6, random, 5);
    expect(sliceUnderNeedle(rotation0, 6)).toBe(1);
    expect(sliceUnderNeedle(rotation5, 6)).toBe(1);
  });
});

describe("slicesFromRanking", () => {
  const ranking: RankingRow[] = [
    { id: "a", name: "Thai Orchid", probability: 0.5, color: "#111" },
    { id: "b", name: "Burger Barn", probability: 0.3, color: "#222" },
    { id: "c", name: "La Trattoria", probability: 0.2, color: "#333" },
  ];

  it("uses the full ranking when no wheel_ids are given", () => {
    expect(slicesFromRanking(ranking)).toEqual([
      { id: "a", name: "Thai Orchid", color: "#111" },
      { id: "b", name: "Burger Barn", color: "#222" },
      { id: "c", name: "La Trattoria", color: "#333" },
    ]);
  });

  it("filters down to only the given wheel_ids, preserving ranking order", () => {
    expect(slicesFromRanking(ranking, ["c", "a"])).toEqual([
      { id: "a", name: "Thai Orchid", color: "#111" },
      { id: "c", name: "La Trattoria", color: "#333" },
    ]);
  });

  it("falls back to the full ranking when wheel_ids is empty", () => {
    expect(slicesFromRanking(ranking, [])).toHaveLength(3);
  });
});
