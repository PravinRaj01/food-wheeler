"use client";

import { motion } from "motion/react";
import {
  BadgeCheck,
  Coins,
  Flame,
  Gem,
  Home,
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
import type { RankingRow, TiebreakerResponse } from "@/lib/decide/types";
import { DevComparison } from "@/components/decide/dev-comparison";

// No emoji from the backend any more (see app.py's DIMENSION_VALUES) - each
// (dimension id, answer) pair maps to its own lucide icon here instead. A
// cuisine question's `answer` is an arbitrary string ("Thai", "Mexican", …)
// decided at request time, so it falls through to the generic fork-and-
// knife icon rather than getting its own entry.
const OPTION_ICONS: Record<string, Record<string, LucideIcon>> = {
  service: { fast_food: Zap, sit_down: UtensilsCrossed },
  spice: { hot: Flame, mild: Milk },
  setting: { patio: Trees, indoor: Home },
  price: { low: Coins, mid: Wallet, high: Gem },
  diet: { vegan: Sprout, vegetarian: Salad, halal: BadgeCheck, gluten_free: Wheat, none: Utensils },
};

function optionIcon(dimensionId: string, answer: string): LucideIcon {
  return OPTION_ICONS[dimensionId]?.[answer] ?? Utensils;
}

export function MediatorPanel({
  response,
  onAnswer,
  onSpinAnyway,
  devMode,
}: {
  response: TiebreakerResponse;
  onAnswer: (answer: { question_id: string; answer: string; text: string }) => void;
  onSpinAnyway: () => void;
  devMode: boolean;
}) {
  const maxP = Math.max(...response.contenders.map((c) => c.probability), 0.0001);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", bounce: 0.35, duration: 0.6 }}
      className="glass rounded-2xl p-6 text-center"
    >
      <p className="mb-2 text-[11px] tracking-wide text-cream/40">via {response.engine.label}</p>
      <div role="status" aria-live="polite">
        <h2 className="font-display mb-5 text-xl text-cream">{response.question.prompt}</h2>
      </div>

      <div className="mb-6 space-y-3 text-left">
        {response.contenders.map((c) => (
          <ContenderBar key={c.id} row={c} maxP={maxP} />
        ))}
      </div>

      {devMode && response.comparison && <DevComparison comparison={response.comparison} />}

      <div className="grid grid-cols-2 gap-3">
        {response.question.options.map((opt) => {
          const Icon = optionIcon(response.question.id, opt.answer);
          return (
            <button
              key={opt.answer}
              type="button"
              onClick={() => onAnswer({ question_id: response.question.id, answer: opt.answer, text: opt.text })}
              className="hairline-b flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-line text-sm font-medium text-cream transition-colors hover:bg-glass"
            >
              <Icon className="h-4 w-4 text-ember" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-cream/40">
        Round {response.round + 1} of 2 ·{" "}
        <button type="button" onClick={onSpinAnyway} className="text-cream/60 underline">
          Spin anyway
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
