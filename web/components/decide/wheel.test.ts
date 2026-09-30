import { describe, expect, it } from "vitest";
import { computeLandingRotation, sliceSpans, sliceUnderNeedle } from "./wheel";

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

// A deterministic, reproducible set of uneven weight vectors (each sums to 1)
// standing in for real engine scores, including a lopsided one and one at the
// 5% floor the app actually uses.
function weightsFor(trial: number, count: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => 1 + ((trial * 7 + i * 13) % 10));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

describe("sliceSpans", () => {
  it("lays slices end to end around the full circle, sized by weight", () => {
    const spans = sliceSpans([0.5, 0.25, 0.25]);
    expect(spans[0].start).toBe(0);
    expect(spans[2].end).toBeCloseTo(2 * Math.PI);
    expect(spans[0].end - spans[0].start).toBeCloseTo(Math.PI);
    expect(spans[1].end).toBeCloseTo(spans[2].start);
  });
});

describe("computeLandingRotation / sliceUnderNeedle", () => {
  it("always lands the needle back on the winning slice, across 1000 random jitter samples and weightings", () => {
    for (let trial = 0; trial < 1000; trial++) {
      const sliceCount = 2 + (trial % 7); // 2..8 slices
      const weights = weightsFor(trial, sliceCount);
      const winnerIndex = trial % sliceCount;
      // A fixed pseudo-random sequence per trial so failures are reproducible,
      // covering the full [0, 1) jitter range rather than relying on the
      // real Math.random - full coverage is the point of a property test.
      const random = () => (trial * 2654435761) % 1000 / 1000;

      const rotation = computeLandingRotation(winnerIndex, weights, random);
      expect(sliceUnderNeedle(rotation, weights)).toBe(winnerIndex);
    }
  });

  it("stays inside the slice even at the extreme ends of the jitter range, for a lopsided wheel", () => {
    const weights = [0.6, 0.2, 0.1, 0.05, 0.05];
    for (const random of [() => 0, () => 0.999999]) {
      for (let winnerIndex = 0; winnerIndex < weights.length; winnerIndex++) {
        const rotation = computeLandingRotation(winnerIndex, weights, random);
        expect(sliceUnderNeedle(rotation, weights)).toBe(winnerIndex);
      }
    }
  });

  it("still works for an even wheel", () => {
    for (let count = 2; count <= 8; count++) {
      for (let winnerIndex = 0; winnerIndex < count; winnerIndex++) {
        const rotation = computeLandingRotation(winnerIndex, equal(count), () => 0.5);
        expect(sliceUnderNeedle(rotation, equal(count))).toBe(winnerIndex);
      }
    }
  });

  it("adding extra full turns never changes which slice the needle lands on", () => {
    const weights = [0.4, 0.3, 0.2, 0.1];
    const rotation0 = computeLandingRotation(1, weights, () => 0.5, 0);
    const rotation5 = computeLandingRotation(1, weights, () => 0.5, 5);
    expect(sliceUnderNeedle(rotation0, weights)).toBe(1);
    expect(sliceUnderNeedle(rotation5, weights)).toBe(1);
  });
});
