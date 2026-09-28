"use client";

import { Cpu, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineId, EngineListItem } from "@/lib/decide/types";

const ICONS: Record<EngineId, typeof Zap> = { laya: Zap, gliner: Target, clm_8b: Cpu };
const CAPTIONS: Record<EngineId, string> = {
  laya: "Fast, joint-attention model",
  gliner: "CPU-first, handles exclusions well",
  clm_8b: "Dual-encoder — needs a GPU server",
};

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
          const Icon = ICONS[e.id];
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
        {locked ? "Locked for this round — start over to change engines" : CAPTIONS[selected]}
      </p>
    </div>
  );
}
