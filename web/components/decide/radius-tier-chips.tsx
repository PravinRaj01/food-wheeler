"use client";

import { cn } from "@/lib/utils";
import type { RadiusTier } from "@/lib/decide/types";

const TIERS: { id: RadiusTier; label: string; sub: string }[] = [
  { id: "local", label: "Local", sub: "1.5 km" },
  { id: "city", label: "City Explorer", sub: "5 km" },
  { id: "roadtrip", label: "Road Trip", sub: "15 km" },
];

export function RadiusTierChips({
  selected,
  locked,
  onSelect,
}: {
  selected: RadiusTier;
  locked: boolean;
  onSelect: (tier: RadiusTier) => void;
}) {
  return (
    <div className="flex gap-2">
      {TIERS.map((tier) => {
        const active = tier.id === selected;
        return (
          <button
            key={tier.id}
            type="button"
            disabled={locked}
            onClick={() => onSelect(tier.id)}
            className={cn(
              "min-h-11 flex-1 rounded-xl border border-line px-2 py-2 text-center transition-colors",
              active ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)]" : "bg-glass",
              locked && "cursor-not-allowed opacity-50",
            )}
          >
            <p className={cn("text-xs font-medium", active ? "text-ember" : "text-cream/70")}>{tier.label}</p>
            <p className="text-[10px] text-cream/40">{tier.sub}</p>
          </button>
        );
      })}
    </div>
  );
}
