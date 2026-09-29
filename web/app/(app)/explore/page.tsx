"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { listPlaces } from "@/lib/api";
import { useLocation } from "@/lib/location/location-provider";
import { isCrossBorderEnabled } from "@/lib/cross-border";
import { cn } from "@/lib/utils";
import type { Place } from "@/lib/decide/types";
import { DEFAULT_RADIUS_KM } from "@/lib/decide/types";
import { CUISINES, DIETS } from "@/lib/decide/cuisines";
import { RadiusSlider } from "@/components/decide/radius-slider";
import { PlaceCard } from "@/components/explore/place-card";

const ExploreMap = dynamic(() => import("@/components/explore/explore-map").then((m) => m.ExploreMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-glass" />,
});

// "All" plus the same local cuisines Decide's Craving chips offer - not the
// old US-centric Mexican/Italian/American/Vegan list, which had no
// Malay/Indian/Chinese option at all despite this app being built for
// Malaysia. See lib/decide/cuisines.ts.
const CUISINE_FILTERS = [{ label: "All", needles: [] as string[] }, ...CUISINES];
const DIET_FILTERS: { id: string | null; label: string }[] = [{ id: null, label: "Any diet" }, ...DIETS];

export default function ExplorePage() {
  const loc = useLocation();
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [cuisineLabel, setCuisineLabel] = useState("All");
  const [diet, setDiet] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const hasLocation = loc.status === "granted" && loc.location != null;
  const selectedCuisine = CUISINE_FILTERS.find((c) => c.label === cuisineLabel);

  useEffect(() => {
    // No location, no fetch - there's no demo set any more to fall back
    // to, and the backend would just refuse this with LOCATION_REQUIRED.
    // The empty state below (with its own "turn on location" action) covers
    // this case instead of a wasted round-trip; `places` below is rendered
    // gated on `hasLocation` too, so stale results from before location was
    // turned off don't need clearing here.
    if (!hasLocation) return;
    let cancelled = false;
    // Data-fetching effects are one of the cases React's own docs treat as
    // a legitimate Effect (see "You Might Not Need an Effect" -> Fetching
    // data): setting the loading flag as the fetch starts, then clearing it
    // in .then()/.finally(), is the standard shape - there's no meaningful
    // way to move this particular setState into a callback without adding
    // a data-fetching library just to satisfy the linter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listPlaces(loc.location, radiusKm, {
      cuisine: selectedCuisine?.needles.length ? selectedCuisine.needles.join(",") : undefined,
      diet: diet ?? undefined,
      crossBorder: isCrossBorderEnabled(),
    })
      .then((res) => {
        if (cancelled) return;
        setPlaces(res.places);
        setSelectedId(res.places[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setPlaces([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // selectedCuisine is derived from cuisineLabel each render, not itself
    // stable - depending on cuisineLabel (the actual state) is correct and
    // avoids re-fetching on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLocation, loc.location, radiusKm, cuisineLabel, diet]);

  return (
    // Mobile: an ordinary scrolling page (the list renders at full length
    // below the map/filters, with bottom padding for the fixed bottom nav)
    // - the old h-[calc(100dvh-3.5rem)] + inner-scroll layout didn't account
    // for that nav, so the list was squeezed into a sliver behind it.
    // md+: back to the split map/list view, with the list scrolling in its
    // own panel.
    <div className="flex flex-col pb-24 md:h-[calc(100dvh-3.5rem)] md:flex-row md:pb-0">
      {/* Map */}
      <div className="relative h-56 shrink-0 md:h-auto md:flex-1">
        <ExploreMap places={hasLocation ? places : []} userLocation={loc.location} selectedId={selectedId} onSelect={setSelectedId} />
        {!hasLocation && (
          <div className="absolute top-3 left-3 rounded-full bg-black/50 px-3 py-1 text-[11px] text-pale/80 backdrop-blur">
            Turn on location to see real places nearby
          </div>
        )}
      </div>

      {/* List panel */}
      <div className="glass flex min-h-0 flex-col gap-4 p-4 md:w-96 md:flex-none md:overflow-hidden">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold text-cream">Explore</h1>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 rounded-full bg-glass px-3 py-1.5 text-xs text-cream/60"
          >
            <MapPin className="h-3.5 w-3.5" />
            {loc.status === "granted" ? "Near you" : loc.status === "locating" ? "Locating…" : "Location off"}
          </Link>
        </div>

        <RadiusSlider km={radiusKm} locked={false} onChange={setRadiusKm} />

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {CUISINE_FILTERS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setCuisineLabel(c.label)}
              className={cn(
                "shrink-0 rounded-full border border-line px-3 py-1 text-xs whitespace-nowrap transition-colors",
                cuisineLabel === c.label
                  ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember"
                  : "bg-glass text-cream/60",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {DIET_FILTERS.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => setDiet(d.id)}
              className={cn(
                "shrink-0 rounded-full border border-line px-3 py-1 text-xs whitespace-nowrap transition-colors",
                diet === d.id
                  ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember"
                  : "bg-glass text-cream/60",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 space-y-2 md:flex-1 md:overflow-y-auto">
          {!hasLocation && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-cream/50">
                Turn on location so your third wheel can find real places nearby.
              </p>
              <button
                type="button"
                onClick={() => loc.enable()}
                className="rounded-full bg-ember px-4 py-2 text-sm font-medium text-ink"
              >
                Turn on location
              </button>
            </div>
          )}
          {hasLocation && loading && <p className="py-8 text-center text-sm text-cream/40">Loading places…</p>}
          {hasLocation && !loading && places.length === 0 && (
            <p className="py-8 text-center text-sm text-cream/40">No places match those filters.</p>
          )}
          {hasLocation &&
            !loading &&
            places.map((p) => (
              <PlaceCard
                key={p.id}
                place={p}
                allPlaces={places}
                source="osm"
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
