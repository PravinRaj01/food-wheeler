"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Dices, MessageCircleQuestion } from "lucide-react";
import type { Candidate, EngineId, RankedResponse, RankingRow } from "@/lib/decide/types";
import { formatDistance } from "@/lib/decide/distance";
import { mealCaption, mustsCaption, relaxedCaption } from "@/lib/decide/meal";
import { SHORTLIST_SIZE } from "@/lib/decide/weighted";
import { cn } from "@/lib/utils";
import { DevComparison } from "@/components/decide/dev-comparison";
import { DirectionsButton } from "@/components/decide/directions-button";
import { HoursLink } from "@/components/decide/hours-link";

/** The ranked answer - the engine's real opinion, best first, instead of a
 * pre-picked winner. Each row's bar is RELATIVE to the top pick (the #1 place
 * is a full bar): the engines split probability across every candidate, so
 * even a genuinely good match scores 20-30% in absolute terms, which read as
 * "bad match" when shown raw. The raw score lives in the expanded detail.
 * From here the couple can pick a place, spin (weighted by these same
 * scores), or - when the top two are close - settle it with one question. */
/** How far a place moved against the primary engine's list, Dev Mode only. */
function RankShift({ from, to, label }: { from: number | undefined; to: number; label: string }) {
  if (from === undefined || from === to) return null;
  const up = from > to; // was further down the primary's list
  return (
    <span className={cn("shrink-0 text-[10px] tabular-nums", up ? "text-teal-400" : "text-cream/40")}>
      {up ? "▲" : "▼"}
      {Math.abs(from - to)} vs {label}
    </span>
  );
}

export function ResultsList({
  response,
  p1Name,
  p2Name,
  devMode,
  primary,
  onViewEngine,
  onPick,
  onSpin,
  onOpenQuestion,
}: {
  /** What to show - the primary engine's answer, or in Dev Mode whichever
   * engine's ranking is selected (see viewedResponse in lib/decide/machine.ts). */
  response: RankedResponse;
  p1Name: string;
  p2Name: string;
  devMode: boolean;
  /** The primary engine's own ranking, so a switched view can show how far
   * each place moved against it. */
  primary: { id: EngineId; label: string; ranking: RankingRow[] };
  onViewEngine: (id: EngineId) => void;
  onPick: (id: string) => void;
  onSpin: () => void;
  onOpenQuestion: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = response.ranking.slice(0, SHORTLIST_SIZE);
  const byId = new Map<string, Candidate>(response.candidates.map((c) => [c.id, c]));
  const topP = rows[0]?.probability || 1;
  const meal = mealCaption(response.meal);
  const musts = mustsCaption(response.musts);
  const relaxed = relaxedCaption(response.relaxed);
  const viewingOther = response.engine.id !== primary.id;
  const primaryIndex = new Map(primary.ranking.map((r, i) => [r.id, i]));
  const centre = response.search_center;
  const centreOwner = centre
    ? (centre.mentioned_by === "p2" ? p2Name : p1Name) || (centre.mentioned_by === "p2" ? "Partner Two" : "Partner One")
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
      className="glass rounded-2xl p-5"
    >
      <p className="text-[11px] tracking-[0.15em] text-cream/40 uppercase">via {response.engine.label}</p>
      <h2 className="font-display mt-1 text-2xl leading-tight text-cream">
        {rows.length === 1 ? "One place fits" : `Your top ${rows.length}`}
      </h2>
      {(meal || musts) && (
        <p className="mt-1 text-xs text-cream/60">
          {[meal?.text, musts].filter(Boolean).join(" · ")}
          {meal?.hint && <span className="text-cream/35"> ({meal.hint})</span>}
        </p>
      )}
      {relaxed && <p className="mt-1 text-xs text-ember/90">{relaxed}</p>}
      {centre && (
        <p className="mt-1 text-xs text-cream/50">
          Searched near {centre.name} — {centreOwner}&apos;s idea
        </p>
      )}

      <ol className="mt-4 space-y-2" role="list">
        {rows.map((row, i) => {
          const c = byId.get(row.id);
          if (!c) return null;
          const open = openId === row.id;
          return (
            <li key={row.id} className={cn("rounded-xl border border-line", open && "bg-glass")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : row.id)}
                className="w-full rounded-xl px-3 py-3 text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium text-cream">
                    <span className="mr-2 text-cream/40">{i + 1}</span>
                    {c.name}
                  </p>
                  {i === 0 && (
                    <span className="shrink-0 text-[10px] tracking-wide text-ember uppercase">Top pick</span>
                  )}
                  {i !== 0 && viewingOther && <RankShift from={primaryIndex.get(row.id)} to={i} label={primary.label} />}
                </div>
                <p className="mt-0.5 text-xs text-cream/50">
                  {c.cuisine} · {c.price} · {formatDistance(c)}
                </p>
                <div
                  role="meter"
                  aria-label="Match strength relative to the top pick"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((row.probability / topP) * 100)}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-glass"
                >
                  <div
                    className="h-full rounded-full bg-ember"
                    style={{ width: `${Math.max((row.probability / topP) * 100, 4)}%` }}
                  />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3">
                      <p className="text-xs text-cream/60">
                        {response.engine.label} score {Math.round(row.probability * 100)}% — the engine splits 100%
                        across all {response.ranking.length} places it weighed, so this is a share, not a grade.
                      </p>
                      {c.address && c.address !== "Nearby" && <p className="mt-1 text-xs text-cream/50">{c.address}</p>}
                      {c.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.tags.slice(0, 5).map((t) => (
                            <span key={t} className="rounded-full bg-glass px-2.5 py-1 text-[11px] text-cream/70">
                              {t.replace("_", " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <DirectionsButton lat={c.lat} lng={c.lng} name={c.name} />
                        <button
                          type="button"
                          onClick={() => onPick(row.id)}
                          className="flex items-center justify-center gap-1.5 rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
                        >
                          <Check className="h-4 w-4" /> Let&apos;s go here
                        </button>
                      </div>
                      <HoursLink place={c} className="mt-2.5 text-center" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>

      {devMode && response.comparison && (
        <div className="mt-4">
          <DevComparison comparison={response.comparison} viewing={response.engine.id} onSelect={onViewEngine} />
        </div>
      )}

      <div className="mt-5 space-y-3">
        {rows.length > 1 && (
          <button
            type="button"
            onClick={onSpin}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
          >
            <Dices className="h-4 w-4" /> Spin between these
          </button>
        )}
        {response.question && (
          <button
            type="button"
            onClick={onOpenQuestion}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-cream/60 underline"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5" /> Too close? Settle it with one question
          </button>
        )}
      </div>
    </motion.div>
  );
}
