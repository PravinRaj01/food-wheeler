"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { local } from "@/lib/safe-storage";

const NAMES_KEY = "fw_names";
const NAMES_SKIPPED_KEY = "fw_names_skipped";

export function saveNames(p1: string, p2: string) {
  local.set(NAMES_KEY, JSON.stringify({ p1: p1.trim(), p2: p2.trim() }));
}

/** Asked once, ever, per browser - see decide/page.tsx's mount effect for
 * how a returning visitor skips straight past this. */
export function NamesStep({
  onContinue,
  onSkip,
}: {
  onContinue: (p1Name: string, p2Name: string) => void;
  onSkip: () => void;
}) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");

  function handleContinue() {
    saveNames(p1, p2);
    onContinue(p1.trim(), p2.trim());
  }

  function handleSkip() {
    local.set(NAMES_SKIPPED_KEY, "1");
    onSkip();
  }

  return (
    <motion.div
      key="names"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="glass rounded-2xl p-6 text-center"
    >
      <h2 className="font-display text-xl text-cream">Who&apos;s eating?</h2>
      <p className="mt-1.5 text-sm text-cream/60">
        So your third wheel can talk to you both by name. Totally optional.
      </p>

      <div className="mt-5 space-y-3 text-left">
        <input
          type="text"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          placeholder="Partner One's name"
          maxLength={30}
          className="w-full rounded-xl border border-line bg-glass px-4 py-3 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
        <input
          type="text"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          placeholder="Partner Two's name"
          maxLength={30}
          className="w-full rounded-xl border border-line bg-glass px-4 py-3 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
      </div>

      <button
        type="button"
        onClick={handleContinue}
        className="mt-5 w-full rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        Continue
      </button>
      <button type="button" onClick={handleSkip} className="mt-3 text-sm text-cream/50 underline underline-offset-4">
        Skip for now
      </button>
    </motion.div>
  );
}
