"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { session } from "@/lib/safe-storage";
import type { Place } from "@/lib/decide/types";
import { formatDistance } from "@/lib/decide/distance";

const SEED_KEY = "fw_seeded_candidates";
const SEED_POOL_SIZE = 6;

export function PlaceCard({
  place,
  allPlaces,
  source,
  selected,
  onSelect,
}: {
  place: Place;
  allPlaces: Place[];
  source: "osm" | "mock";
  selected: boolean;
  onSelect: () => void;
}) {
  const router = useRouter();

  function addToWheel() {
    // Seed the Decide flow's candidate pool with this place first, then
    // fill up to SEED_POOL_SIZE with the nearest others already loaded
    // here - no extra API call, and the AI still gets real choices to
    // weigh, not just this one place forced as the answer.
    const rest = allPlaces.filter((p) => p.id !== place.id).slice(0, SEED_POOL_SIZE - 1);
    const candidates = [place, ...rest];
    try {
      session.set(SEED_KEY, JSON.stringify({ candidates, source }));
    } catch {
      /* ignore - decide page just won't find a seed */
    }
    router.push("/decide");
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        "glass cursor-pointer rounded-xl p-4 transition-colors",
        selected && "border-ember/60 bg-[color-mix(in_oklab,var(--ember)_10%,transparent)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-cream">{place.name}</p>
          <p className="mt-0.5 text-xs text-cream/50">
            {place.cuisine} · {place.price} · {formatDistance(place)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {place.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-glass px-2 py-0.5 text-[10px] text-cream/60">
                {t.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addToWheel();
          }}
          title="Add to tonight's wheel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember text-ink transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
