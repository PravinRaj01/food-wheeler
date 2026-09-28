"use client";

import { cn } from "@/lib/utils";
import { RADIUS_KM_MAX, RADIUS_KM_MIN, RADIUS_PRESETS_KM } from "@/lib/decide/types";

function describeRadius(km: number): string {
  if (km <= 2) return "Walking distance";
  if (km <= 7) return "Nearby";
  if (km <= 20) return "A short drive";
  return "Road trip territory";
}

export function RadiusSlider({
  km,
  locked,
  onChange,
}: {
  km: number;
  locked: boolean;
  onChange: (km: number) => void;
}) {
  const pct = ((km - RADIUS_KM_MIN) / (RADIUS_KM_MAX - RADIUS_KM_MIN)) * 100;

  return (
    <div className={cn("rounded-xl border border-line bg-glass p-3", locked && "opacity-50")}>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-medium text-cream/70">{describeRadius(km)}</p>
        <p className="font-display text-sm font-semibold text-ember">{km % 1 === 0 ? km : km.toFixed(1)} km</p>
      </div>

      <input
        type="range"
        min={RADIUS_KM_MIN}
        max={RADIUS_KM_MAX}
        step={0.5}
        value={km}
        disabled={locked}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Search radius in kilometers"
        className="h-2 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
        style={{
          accentColor: "var(--ember)",
          background: `linear-gradient(to right, var(--ember) ${pct}%, var(--line-strong) ${pct}%)`,
        }}
      />

      <div className="mt-2.5 flex gap-1.5">
        {RADIUS_PRESETS_KM.map((preset) => {
          const active = km === preset.km;
          return (
            <button
              key={preset.label}
              type="button"
              disabled={locked}
              onClick={() => onChange(preset.km)}
              className={cn(
                "min-h-8 flex-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                active ? "bg-ember text-ink" : "bg-black/15 text-cream/50 hover:text-cream/80",
                locked && "cursor-not-allowed",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
