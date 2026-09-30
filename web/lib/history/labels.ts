export type ChosenVia = "picked" | "spun";

// Rows saved before the ranked-results flow only carry the old engine
// verdict in `reason` - "confident" and "only_option" were the engine's own
// pick (closest to "picked"), "fair_spin" was a spin.
const LEGACY_LABEL: Record<string, string> = {
  confident: "Top pick",
  only_option: "Only option",
  fair_spin: "Spun",
  picked: "Picked",
  spun: "Spun",
};

/** Whether a decision was picked or spun - what the Picked/Spun filter chips
 * match on, across both new and legacy `reason` values. */
export function viaOf(reason: string): ChosenVia {
  return reason === "spun" || reason === "fair_spin" ? "spun" : "picked";
}

/** The `reason` values each filter chip matches (see viaOf) - for SQL. */
export const REASONS_BY_VIA: Record<ChosenVia, string[]> = {
  picked: ["picked", "confident", "only_option"],
  spun: ["spun", "fair_spin"],
};

/** How a decision was made, for the history row's badge - matching the
 * reveal screen's own wording, and never the model's raw probability (which
 * reads as a bad match even for a good one: see results-list.tsx). */
export function badgeLabel(row: { reason: string; rank: number | null; shortlistSize: number | null }): string {
  if (row.rank != null && row.shortlistSize != null) {
    return `${viaOf(row.reason) === "spun" ? "Spun" : "Picked"} · #${row.rank} of ${row.shortlistSize}`;
  }
  return LEGACY_LABEL[row.reason] ?? "Decided";
}
