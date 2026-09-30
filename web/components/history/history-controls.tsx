"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CUISINE_LABELS, filtersToSearch, type HistoryFilters } from "@/lib/history/filters";

const chip = (active: boolean) =>
  cn(
    "shrink-0 rounded-full border border-line px-3 py-1 text-xs whitespace-nowrap transition-colors",
    active ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember" : "bg-glass text-cream/60",
  );

/** Search, cuisine and Picked/Spun filters, and the All/Favourites switch.
 * Everything lives in the URL (?q=&cuisine=&via=&tab=), so the server page
 * re-queries with it - the list is paged in SQL, so filtering can't be done
 * over whatever rows happen to be loaded on the client. This component isn't
 * keyed on the filters (unlike the list below it), so typing in the search
 * box never remounts it and loses focus. */
export function HistoryControls({ filters }: { filters: HistoryFilters }) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.q);
  // The last search text THIS component put in the URL. If the URL's q ever
  // differs from it, the change came from elsewhere (e.g. a "clear filters"
  // link) and the box follows it - whereas our own navigation arriving back
  // as a prop must not overwrite characters typed while it was in flight.
  const [sentQ, setSentQ] = useState(filters.q);
  if (filters.q !== sentQ) {
    setSentQ(filters.q);
    setSearch(filters.q);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function go(next: HistoryFilters) {
    router.replace(`/history${filtersToSearch(next)}`, { scroll: false });
  }

  // Debounced: a URL update (and a server round trip) per keystroke would
  // both hammer the database and re-render the list under the user's typing.
  function onSearch(value: string) {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = value.trim().slice(0, 80);
      setSentQ(q);
      go({ ...filters, q });
    }, 350);
  }

  return (
    <div className="mt-6 space-y-3">
      <div role="tablist" aria-label="History view" className="grid grid-cols-2 rounded-xl border border-line p-1 text-sm">
        {(["all", "favourites"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={filters.tab === tab}
            onClick={() => go({ ...filters, tab })}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors",
              filters.tab === tab ? "bg-ember text-ink" : "text-cream/60",
            )}
          >
            {tab === "favourites" && <Star className="h-3.5 w-3.5" />}
            {tab === "all" ? "All" : "Favourites"}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search history</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-cream/40" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search a place, or what you asked for"
          maxLength={80}
          className="w-full rounded-xl border border-line bg-glass py-2.5 pr-3 pl-9 text-base text-cream placeholder-cream/30 outline-none focus:border-ember"
        />
      </label>

      <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
        <button type="button" className={chip(filters.via === "picked")} onClick={() => go({ ...filters, via: filters.via === "picked" ? null : "picked" })}>
          Picked
        </button>
        <button type="button" className={chip(filters.via === "spun")} onClick={() => go({ ...filters, via: filters.via === "spun" ? null : "spun" })}>
          Spun
        </button>
        <span aria-hidden className="mx-1 w-px shrink-0 bg-line" />
        {CUISINE_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={chip(filters.cuisine === label)}
            onClick={() => go({ ...filters, cuisine: filters.cuisine === label ? null : label })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
