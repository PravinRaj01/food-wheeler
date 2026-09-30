import type { RankingRow } from "@/lib/decide/types";

/** How many of the ranked places the results list shows and the wheel spins
 * between. */
export const SHORTLIST_SIZE = 5;

// A slice never shrinks below this share of the wheel, so even the fifth
// place is a visible, spinnable sliver rather than a hairline nobody can hit.
const MIN_SHARE = 0.05;

export interface WeightedSlice {
  id: string;
  name: string;
  color: string;
  /** Share of the wheel, 0..1, summing to 1 across the wheel. */
  weight: number;
}

/** The top `n` ranked places as wheel slices, sized by score: each engine
 * score is renormalized over just these `n` (the engines split probability
 * across ALL candidates, so the raw numbers don't add to 1 here), then
 * floored at MIN_SHARE and renormalized once more. A better match gets a
 * bigger slice - chance, nudged by what the couple said - and nothing is
 * decided until the spin. */
export function topWeights(ranking: RankingRow[], n = SHORTLIST_SIZE): WeightedSlice[] {
  const top = ranking.slice(0, n);
  if (top.length === 0) return [];
  const total = top.reduce((sum, r) => sum + Math.max(r.probability, 0), 0);
  const floored = top.map((r) => Math.max(total > 0 ? Math.max(r.probability, 0) / total : 1 / top.length, MIN_SHARE));
  const sum = floored.reduce((a, b) => a + b, 0);
  return top.map((r, i) => ({ id: r.id, name: r.name, color: r.color, weight: floored[i] / sum }));
}

/** Weighted random draw: returns the id of the slice `random()` lands in.
 * Pure (takes its randomness) so the distribution is testable; the caller
 * draws ONCE just before the spin and the wheel animates to that slice, so
 * the odds really are the slice sizes shown. */
export function pickWeighted(slices: { id: string; weight: number }[], random: () => number = Math.random): string {
  const total = slices.reduce((sum, s) => sum + s.weight, 0);
  let r = random() * total;
  for (const s of slices) {
    r -= s.weight;
    if (r < 0) return s.id;
  }
  return slices[slices.length - 1].id;
}
