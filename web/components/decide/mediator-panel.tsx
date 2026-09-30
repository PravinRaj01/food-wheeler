"use client";

import { motion } from "motion/react";
import {
  BadgeCheck,
  Coins,
  Flame,
  Gem,
  Home,
  MapPin,
  Milk,
  Salad,
  Sprout,
  Trees,
  UtensilsCrossed,
  Utensils,
  Wallet,
  Wheat,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { MediatorQuestion, RankingRow } from "@/lib/decide/types";

// No emoji from the backend any more (see app.py's DIMENSION_VALUES) - each
// (dimension id, answer) pair maps to its own lucide icon here instead. A
// cuisine question's `answer` is an arbitrary string ("Thai", "Mexican", …)
// decided at request time, so it falls through to the generic fork-and-
// knife icon rather than getting its own entry. "location" (see app.py's
// build_location_question) has an arbitrary `answer` too ("p1"/"p2"), but
// both of its options mean the same thing - somewhere to search - so they
// share one icon rather than falling through to the generic one.
const OPTION_ICONS: Record<string, Record<string, LucideIcon>> = {
  service: { fast_food: Zap, sit_down: UtensilsCrossed },
  spice: { hot: Flame, mild: Milk },
  setting: { patio: Trees, indoor: Home },
  price: { low: Coins, mid: Wallet, high: Gem },
  diet: { vegan: Sprout, vegetarian: Salad, halal: BadgeCheck, gluten_free: Wheat, none: Utensils },
  location: { p1: MapPin, p2: MapPin },
};

function optionIcon(dimensionId: string, answer: string): LucideIcon {
  return OPTION_ICONS[dimensionId]?.[answer] ?? Utensils;
}

/** One joint question, answered together. Two kinds share this panel:
 * - "close": OPTIONAL, raised from the results list when the top two are
 *   close and a dimension separates them - "Back to the list" is the way out.
 * - "location": FORCED, the partners named two different places to search
 *   around (nothing has been fetched yet, so there's no list to go back to) -
 *   "Just pick one" defaults to the first mention instead of asking again. */
export function MediatorPanel({
  question,
  kind,
  round,
  engineLabel,
  contenders = [],
  onAnswer,
  onSecondary,
}: {
  question: MediatorQuestion;
  kind: "close" | "location";
  round: number;
  engineLabel: string;
  contenders?: RankingRow[];
  onAnswer: (answer: { question_id: string; answer: string; text: string }) => void;
  onSecondary: () => void;
}) {
  const maxP = Math.max(...contenders.map((c) => c.probability), 0.0001);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", bounce: 0.35, duration: 0.6 }}
      className="glass rounded-2xl p-6 text-center"
    >
      <p className="mb-2 text-[11px] tracking-wide text-cream/40">via {engineLabel}</p>
      <div role="status" aria-live="polite">
        <h2 className="font-display mb-5 text-xl text-cream">{question.prompt}</h2>
      </div>

      {contenders.length > 0 && (
        <div className="mb-6 space-y-3 text-left">
          {contenders.map((c) => (
            <ContenderBar key={c.id} row={c} maxP={maxP} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {question.options.map((opt) => {
          const Icon = optionIcon(question.id, opt.answer);
          return (
            <button
              key={opt.answer}
              type="button"
              onClick={() => onAnswer({ question_id: question.id, answer: opt.answer, text: opt.text })}
              className="hairline-b flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-line text-sm font-medium text-cream transition-colors hover:bg-glass"
            >
              <Icon className="h-4 w-4 text-ember" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-cream/40">
        Round {round + 1} of 2 ·{" "}
        <button type="button" onClick={onSecondary} className="text-cream/60 underline">
          {kind === "close" ? "Back to the list" : "Just pick one"}
        </button>
      </p>
    </motion.div>
  );
}

function ContenderBar({ row, maxP }: { row: RankingRow; maxP: number }) {
  const pct = Math.round(row.probability * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-cream/70">
        <span>{row.name}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-glass">
        <motion.div
          className="h-full rounded-full bg-ember"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(4, (row.probability / maxP) * 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
