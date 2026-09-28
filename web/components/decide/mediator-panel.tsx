"use client";

import { motion } from "motion/react";
import type { RankingRow, TiebreakerResponse } from "@/lib/decide/types";

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
        <h2 className="font-display text-xl text-cream">Let&apos;s settle this</h2>
        <p className="mb-5 text-sm text-cream/60">{response.question.prompt}</p>
      </div>

      <div className="mb-6 space-y-3 text-left">
        {response.contenders.map((c) => (
          <ContenderBar key={c.id} row={c} maxP={maxP} />
        ))}
      </div>

      {devMode && response.comparison && (
        <div className="mb-4 rounded-lg bg-black/30 p-3 text-left font-mono text-[10px] text-cream/60">
          {Object.entries(response.comparison)
            .map(([id, c]) => (c.error ? `${id}: n/a` : `${id}: ${c.top_name} ${Math.round((c.top_p ?? 0) * 100)}%`))
            .join("   ")}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {response.question.options.map((opt) => (
          <button
            key={opt.answer}
            type="button"
            onClick={() => onAnswer({ question_id: response.question.id, answer: opt.answer, text: opt.text })}
            className="hairline-b flex h-20 items-center justify-center rounded-xl border border-line text-sm font-medium text-cream transition-colors hover:bg-glass"
          >
            {opt.label}
          </button>
        ))}
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
