"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MapPin, Soup, MessageSquareText, Scale, Sparkles } from "lucide-react";
import type { MatchResponse, RankingRow, TiebreakerResponse } from "@/lib/decide/types";
import { decidingIntro } from "@/lib/copy";

/** What decide/page.tsx's submit() hands this component once the server has
 * actually answered - held back from the reducer (see its pendingResult
 * state) until the animation below has run its course, so the wheel/
 * mediator screen never appears before the couple has seen "considering
 * options, then landing on one" play out. */
export type PendingDecideResult =
  | { kind: "match"; response: MatchResponse }
  | { kind: "tiebreaker"; response: TiebreakerResponse };

type Phase = "branch" | "fill" | "converge" | "final";

// Purely decorative captioning while the branch cards are still skeletons -
// same wording/icons the old version used.
const STEPS = [
  { icon: MapPin, text: "Scanning nearby spots…" },
  { icon: Soup, text: "Checking cuisines…" },
  { icon: MessageSquareText, text: "Weighing what you both said…" },
  { icon: Scale, text: "Comparing the options…" },
  { icon: Sparkles, text: "Almost ready…" },
];
const STEP_MS = 1100;

// Fixed holds for each phase after the branch phase's own floor (see below)
// - chosen so branch+fill+converge+final add up to ~2.4s, per the plan.
const MIN_BRANCH_MS = 1000;
const FILL_HOLD_MS = 500;
const CONVERGE_MS = 550;
const FINAL_HOLD_MS = 350;

// A compact 240x100 diagram: one source point branches to 3 candidate
// points, which a separate set of paths later draws converging back into a
// single point - the same "considering several, landing on one" shape as
// before, but every path here uses plain initial/animate driven by `phase`
// state instead of an infinite keyframe-times loop (see the real production
// bug that rewrite fixed: every branch/final element used initial={false},
// which made motion render straight to the LAST keyframe - opacity 0 - and
// never start the loop at all, so production showed nothing but a pulsing
// dot).
const SOURCE = { x: 120, y: 12 };
const BRANCHES = [
  { x: 45, y: 72 },
  { x: 120, y: 72 },
  { x: 195, y: 72 },
];
const CONVERGE_POINT = { x: 120, y: 78 };

function outPath(to: { x: number; y: number }) {
  return `M ${SOURCE.x} ${SOURCE.y} Q ${(SOURCE.x + to.x) / 2} ${(SOURCE.y + to.y) / 2 - 8} ${to.x} ${to.y}`;
}
function inPath(from: { x: number; y: number }) {
  return `M ${from.x} ${from.y} Q ${(from.x + CONVERGE_POINT.x) / 2} ${from.y + 14} ${CONVERGE_POINT.x} ${CONVERGE_POINT.y}`;
}

function truncate(s: string, n: number) {
  const t = s.trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function topCandidatesFrom(pending: PendingDecideResult): RankingRow[] {
  return pending.kind === "match" ? pending.response.ranking.slice(0, 3) : pending.response.contenders.slice(0, 3);
}

/** The final card's text - deliberately never spoils the wheel by naming a
 * winner (except only_option, where there IS no wheel - just one place left
 * standing after the guards ran). */
function finalTextFrom(pending: PendingDecideResult, count: number): string {
  if (pending.kind === "tiebreaker") return "Too close — one question";
  if (pending.response.reason === "only_option") return pending.response.winner.name;
  return `${count} finalist${count === 1 ? "" : "s"} — spinning`;
}

export function DecidingSequence({
  p1Name,
  p2Name,
  p1Text,
  p2Text,
  pendingResult,
  onDone,
}: {
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p2Text: string;
  pendingResult: PendingDecideResult | null;
  onDone: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("branch");
  const [stepIndex, setStepIndex] = useState(0);
  const mountedAtRef = useRef(0);
  // Ref so the phase-timer effects below don't need onDone in their
  // dependency arrays - onDone closes over pendingResult in the parent, so
  // a naive dependency would re-run (and re-schedule) every timer whenever
  // that identity changes.
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    mountedAtRef.current = performance.now();
  }, []);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Caption rotator - only meaningful while genuinely still waiting.
  useEffect(() => {
    if (phase !== "branch") return;
    const id = setInterval(() => setStepIndex((i) => (i + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Reduced motion: skip the choreography entirely. A short, non-animated
  // pause once real data is in hand (so it doesn't read as an instant
  // flash), then straight through - no branch/fill/converge dwell at all.
  useEffect(() => {
    if (!prefersReducedMotion || !pendingResult) return;
    const t = setTimeout(() => onDoneRef.current(), 300);
    return () => clearTimeout(t);
  }, [prefersReducedMotion, pendingResult]);

  // branch -> fill: only once the server has actually answered, and only
  // after MIN_BRANCH_MS has elapsed since mount. That's a FLOOR, not an
  // added delay - a slow response (a cold Overpass fetch) that already took
  // longer than this fills the instant it arrives; a fast one (a cached
  // round) still gets to show its branch cards for a beat first instead of
  // flashing past unreadably.
  useEffect(() => {
    if (prefersReducedMotion) return;
    if (phase !== "branch" || !pendingResult) return;
    const elapsed = performance.now() - mountedAtRef.current;
    const wait = Math.max(0, MIN_BRANCH_MS - elapsed);
    const t = setTimeout(() => setPhase("fill"), wait);
    return () => clearTimeout(t);
  }, [phase, pendingResult, prefersReducedMotion]);

  // fill -> converge -> final -> onDone, each a short fixed hold.
  useEffect(() => {
    if (prefersReducedMotion) return;
    if (phase === "fill") {
      const t = setTimeout(() => setPhase("converge"), FILL_HOLD_MS);
      return () => clearTimeout(t);
    }
    if (phase === "converge") {
      const t = setTimeout(() => setPhase("final"), CONVERGE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "final") {
      const t = setTimeout(() => onDoneRef.current(), FINAL_HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [phase, prefersReducedMotion]);

  const p1Snippet = truncate(p1Text, 30) || p1Name || "Partner One";
  const p2Snippet = truncate(p2Text, 30) || p2Name || "Partner Two";

  if (prefersReducedMotion) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 py-14 text-center">
        <p className="text-sm text-cream/70">
          {pendingResult
            ? finalTextFrom(pendingResult, topCandidatesFrom(pendingResult).length)
            : "Your third wheel is thinking…"}
        </p>
      </div>
    );
  }

  const showBranches = phase === "branch" || phase === "fill";
  const showFinal = phase === "converge" || phase === "final";
  const candidates = pendingResult ? topCandidatesFrom(pendingResult) : [];
  const slotCount = pendingResult ? Math.max(candidates.length, 1) : 3;
  const step = STEPS[stepIndex];
  const StepIcon = step.icon;

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-10 text-center">
      {/* Source: what each partner actually said, or their names */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass w-full max-w-[280px] rounded-xl px-4 py-2 text-xs text-cream/70"
      >
        {decidingIntro(p1Name, p2Name, p1Snippet, p2Snippet)}
      </motion.div>

      {/* Connector diagram: branch paths fade in immediately, converge
          paths only once real data starts folding back into one. */}
      <svg viewBox="0 0 240 100" className="h-20 w-full max-w-[240px]">
        {BRANCHES.map((b, i) => (
          <motion.path
            key={`out-${i}`}
            d={outPath(b)}
            fill="none"
            stroke="var(--ember)"
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={showBranches ? { pathLength: 1, opacity: 0.6 } : { pathLength: 1, opacity: 0.15 }}
            transition={{ duration: 0.45, delay: i * 0.08, ease: "easeOut" }}
          />
        ))}
        {BRANCHES.map((b, i) => (
          <motion.path
            key={`in-${i}`}
            d={inPath(b)}
            fill="none"
            stroke="var(--peach)"
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={showFinal ? { pathLength: 1, opacity: 0.8 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 0.45, delay: i * 0.06, ease: "easeInOut" }}
          />
        ))}
        <motion.circle
          cx={SOURCE.x}
          cy={SOURCE.y}
          r={5}
          fill="var(--ember)"
          initial={{ opacity: 0.5, scale: 0.9 }}
          animate={{ opacity: showBranches ? 1 : 0.3, scale: 1 }}
          transition={{ duration: 0.4 }}
        />
      </svg>

      {/* Branch cards: shimmer skeletons while pending, the real top
          candidates once the server has answered. */}
      <div className="flex w-full max-w-[280px] justify-center gap-2">
        <AnimatePresence mode="popLayout">
          {showBranches &&
            Array.from({ length: slotCount }).map((_, i) => {
              const c = candidates[i];
              return (
                <motion.div
                  key={c?.id ?? `skeleton-${i}`}
                  layout
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.9 }}
                  transition={{ duration: 0.35, delay: i * 0.06 }}
                  className="glass flex-1 rounded-lg px-2 py-3"
                >
                  {c ? (
                    <>
                      <span
                        className="mx-auto mb-1 block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <p className="truncate text-[11px] font-medium text-cream">{c.name}</p>
                      <p className="text-[10px] text-cream/50">{Math.round(c.probability * 100)}%</p>
                    </>
                  ) : (
                    <>
                      <div className="mx-auto mb-2 h-1.5 w-1.5 animate-pulse rounded-full bg-glass-strong" />
                      <div className="mx-auto mb-1 h-2.5 w-4/5 animate-pulse rounded bg-glass-strong" />
                      <div className="mx-auto h-2 w-1/2 animate-pulse rounded bg-glass-strong" />
                    </>
                  )}
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>

      {/* Final card - never spoils the wheel (except only_option, where
          there's no wheel to spoil). */}
      <AnimatePresence>
        {showFinal && pendingResult && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="glass w-full max-w-[240px] rounded-xl px-4 py-3"
          >
            <p className="text-sm font-medium text-cream">{finalTextFrom(pendingResult, candidates.length)}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status caption - only while still genuinely waiting. */}
      {phase === "branch" && (
        <div className="relative h-5">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-x-0 flex items-center justify-center gap-2 text-sm text-cream/70"
            >
              <StepIcon className="h-4 w-4 text-ember" />
              {step.text}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
