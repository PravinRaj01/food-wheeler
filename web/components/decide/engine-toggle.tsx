"use client";

import { cn } from "@/lib/utils";
import { ENGINE_CAPTIONS, ENGINE_ICONS } from "@/lib/decide/engine-meta";
import type { EngineId, EngineListItem } from "@/lib/decide/types";

export function EngineToggle({
  engines,
  selected,
  locked,
  onSelect,
}: {
  engines: EngineListItem[];
  selected: EngineId;
  locked: boolean;
  onSelect: (id: EngineId) => void;
}) {
  if (engines.length === 0) return null;

  return (
    <div>
      <div className="glass flex gap-1 rounded-lg p-1">
        {engines.map((e) => {
          const Icon = ENGINE_ICONS[e.id];
          const active = e.id === selected;
          const disabled = !e.available || (locked && !active);
          return (
            <button
              key={e.id}
              type="button"
              disabled={disabled}
              title={!e.available ? (e.reason ?? "unavailable") : undefined}
              onClick={() => onSelect(e.id)}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors",
                active ? "bg-ember text-ink" : "text-cream/60",
                disabled && "cursor-not-allowed opacity-35",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {e.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-cream/50">
        {locked ? "Locked for this round — start over to change engines" : ENGINE_CAPTIONS[selected]}
      </p>
    </div>
  );
}
