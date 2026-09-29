import type { Candidate } from "@/lib/decide/types";

/** distance_km is only ever a straight line - route_km/route_min (from
 * candidates._route_table(), a real OSRM driving query) is the actual drive
 * when the backend managed to route it. Every place that shows a distance
 * anywhere in the app goes through this, so "how far" always means the same
 * thing wherever it's printed. */
export function formatDistance(c: Pick<Candidate, "distance_km" | "route_km" | "route_min">): string {
  if (c.route_km != null && c.route_min != null) {
    return `${c.route_km} km drive · ${c.route_min} min`;
  }
  return `~${c.distance_km} km straight line`;
}
