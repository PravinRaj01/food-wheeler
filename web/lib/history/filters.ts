import { z } from "zod";
import { CUISINES } from "@/lib/decide/cuisines";
import type { Candidate } from "@/lib/decide/types";
import type { ChosenVia } from "./labels";

/** One history entry as the UI sees it - dates as strings and only the
 * fields it renders, so it crosses the server -> client boundary (and server
 * action returns) as plain data. */
export interface HistoryRow {
  id: string;
  createdAt: string;
  winner: Candidate;
  reason: string;
  rank: number | null;
  shortlistSize: number | null;
  favourite: boolean;
}

export const CUISINE_LABELS = CUISINES.map((c) => c.label);

export interface HistoryFilters {
  q: string;
  cuisine: string | null;
  via: ChosenVia | null;
  tab: "all" | "favourites";
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads the page's ?q=&cuisine=&via=&tab= into a safe HistoryFilters -
 * anything unrecognised (a hand-edited URL) just falls back to "no filter"
 * rather than erroring or reaching the query. */
export function parseHistoryFilters(raw: Record<string, string | string[] | undefined>): HistoryFilters {
  const cuisine = first(raw.cuisine);
  const via = first(raw.via);
  return {
    q: (first(raw.q) ?? "").trim().slice(0, 80),
    cuisine: cuisine && CUISINE_LABELS.includes(cuisine) ? cuisine : null,
    via: via === "picked" || via === "spun" ? via : null,
    tab: first(raw.tab) === "favourites" ? "favourites" : "all",
  };
}

/** True when anything narrows the list - in which case it's shown flat,
 * without the pinned Favourites group above the day sections. */
export function hasActiveFilters(f: HistoryFilters): boolean {
  return f.q !== "" || f.cuisine !== null || f.via !== null;
}

export function filtersToSearch(f: HistoryFilters): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.cuisine) params.set("cuisine", f.cuisine);
  if (f.via) params.set("via", f.via);
  if (f.tab === "favourites") params.set("tab", "favourites");
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** What the "load more" server action accepts - validated again there, since
 * server actions are reachable by any POST, not just this UI. */
export const historyQuerySchema = z.object({
  q: z.string().max(80),
  cuisine: z.enum(CUISINE_LABELS as [string, ...string[]]).nullable(),
  via: z.enum(["picked", "spun"]).nullable(),
  favouritesOnly: z.boolean(),
  excludeFavourites: z.boolean(),
  cursor: z.string().max(200).nullable(),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** What "delete everything matching" accepts: the view's filters, no paging. */
export const historyMatchSchema = historyQuerySchema.pick({ q: true, cuisine: true, via: true, favouritesOnly: true });
export type HistoryMatch = z.infer<typeof historyMatchSchema>;
