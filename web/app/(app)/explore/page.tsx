"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { listPlaces } from "@/lib/api";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { cn } from "@/lib/utils";
import type { Place, RadiusTier } from "@/lib/decide/types";
import { RadiusTierChips } from "@/components/decide/radius-tier-chips";
import { PlaceCard } from "@/components/explore/place-card";

const ExploreMap = dynamic(() => import("@/components/explore/explore-map").then((m) => m.ExploreMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-glass" />,
});

const CUISINE_FILTERS = ["All", "Mexican", "Thai", "Italian", "American", "Vegan"];
const DIET_FILTERS: { id: string | null; label: string }[] = [
  { id: null, label: "Any diet" },
  { id: "vegan", label: "Vegan" },
  { id: "halal", label: "Halal" },
  { id: "gluten_free", label: "Gluten-free" },
];

export default function ExplorePage() {
  const geo = useGeolocation();
  const [tier, setTier] = useState<RadiusTier>("local");
  const [cuisine, setCuisine] = useState("All");
  const [diet, setDiet] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [source, setSource] = useState<"osm" | "mock">("mock");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Data-fetching effects are one of the cases React's own docs treat as
    // a legitimate Effect (see "You Might Not Need an Effect" -> Fetching
    // data): setting the loading flag as the fetch starts, then clearing it
    // in .then()/.finally(), is the standard shape - there's no meaningful
    // way to move this particular setState into a callback without adding
    // a data-fetching library just to satisfy the linter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listPlaces(geo.location, tier, { cuisine: cuisine === "All" ? undefined : cuisine, diet: diet ?? undefined })
      .then((res) => {
        if (cancelled) return;
        setPlaces(res.places);
        setSource(res.source);
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
  }, [geo.location, tier, cuisine, diet]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:flex-row">
      {/* Map */}
      <div className="relative h-64 shrink-0 md:h-auto md:flex-1">
        <ExploreMap places={places} userLocation={geo.location} selectedId={selectedId} onSelect={setSelectedId} />
        {source === "mock" && (
          <div className="absolute top-3 left-3 rounded-full bg-black/50 px-3 py-1 text-[11px] text-cream/80 backdrop-blur">
            Demo places — allow location for real nearby results
          </div>
        )}
      </div>

      {/* List panel */}
      <div className="glass flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:w-96 md:flex-none">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold text-cream">Explore</h1>
          <button
            type="button"
            onClick={geo.request}
            className="flex items-center gap-1.5 rounded-full bg-glass px-3 py-1.5 text-xs text-cream/60"
          >
            <MapPin className="h-3.5 w-3.5" />
            {geo.status === "locating" ? "Locating…" : geo.status === "granted" ? "Near you" : "Use my location"}
          </button>
        </div>

        <RadiusTierChips selected={tier} locked={false} onSelect={setTier} />

        <div className="flex flex-wrap gap-1.5">
          {CUISINE_FILTERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCuisine(c)}
              className={cn(
                "rounded-full border border-line px-3 py-1 text-xs transition-colors",
                cuisine === c ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember" : "bg-glass text-cream/60",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DIET_FILTERS.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => setDiet(d.id)}
              className={cn(
                "rounded-full border border-line px-3 py-1 text-xs transition-colors",
                diet === d.id ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember" : "bg-glass text-cream/60",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {loading && <p className="py-8 text-center text-sm text-cream/40">Loading places…</p>}
          {!loading && places.length === 0 && <p className="py-8 text-center text-sm text-cream/40">No places match those filters.</p>}
          {!loading &&
            places.map((p) => (
              <PlaceCard
                key={p.id}
                place={p}
                allPlaces={places}
                source={source}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
