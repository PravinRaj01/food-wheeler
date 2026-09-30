import { Check, X } from "lucide-react";
import { ENGINE_ACCENTS, ENGINE_ICONS } from "@/lib/decide/engine-meta";
import type { ComparisonEntry, EngineId } from "@/lib/decide/types";

/** Dev Mode's "how would every engine have scored this" readout, one small
 * card per engine. Each is a button: tapping it flips the list above to THAT
 * engine's ranking and scores (tapping the primary flips back). An engine that
 * didn't run (unavailable, timed out) is left out entirely rather than shown
 * as "n/a" - there's nothing to compare for it. */
export function DevComparison({
  comparison,
  viewing,
  onSelect,
}: {
  comparison: Record<string, ComparisonEntry>;
  /** The engine whose ranking the list is currently showing. */
  viewing: EngineId;
  onSelect: (id: EngineId) => void;
}) {
  const entries = Object.entries(comparison).filter(([, c]) => !c.error) as [EngineId, ComparisonEntry][];
  if (entries.length === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {entries.map(([id, c]) => {
        const Icon = ENGINE_ICONS[id];
        const accent = ENGINE_ACCENTS[id];
        const pct = Math.round((c.top_p ?? 0) * 100);
        const selected = id === viewing;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            aria-label={`Show ${id}'s ranking`}
            onClick={() => onSelect(id)}
            className="rounded-xl border p-3 text-left transition-colors"
            style={{
              borderColor: selected ? accent : "var(--line)",
              background: selected ? `color-mix(in oklab, ${accent} 12%, transparent)` : "var(--glass)",
              boxShadow: selected ? `0 0 0 1px ${accent}` : undefined,
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
                  {id}
                </span>
              </div>
              {c.primary ? (
                <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-cream/60 uppercase">
                  Primary
                </span>
              ) : c.agrees === false ? (
                <X className="h-3.5 w-3.5 text-cream/30" />
              ) : (
                <Check className="h-3.5 w-3.5 text-cream/50" />
              )}
            </div>

            <p className="truncate text-sm font-medium text-cream">{c.top_name}</p>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/25">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: accent }} />
            </div>

            <div className="mt-1 flex justify-between text-[10px] text-cream/40">
              <span>{pct}% confidence</span>
              <span>{c.latency_ms}ms</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
