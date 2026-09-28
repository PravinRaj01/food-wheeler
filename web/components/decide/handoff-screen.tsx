"use client";

import { motion } from "motion/react";
import { Smartphone } from "lucide-react";
import { handoffLine } from "@/lib/copy";

/** A real handoff, not a timed auto-advance - Partner Two has to actually
 * tap "ready" before their own input phase starts, so this genuinely
 * covers Partner One's answer changing hands rather than just pausing for
 * a second. */
export function HandoffScreen({
  p1Name,
  p2Name,
  onReady,
}: {
  p1Name: string;
  p2Name: string;
  onReady: () => void;
}) {
  const label = p2Name || "Partner Two";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--orange-3)] p-6 text-center"
    >
      <Smartphone className="h-10 w-10 text-cream/70" />
      <p className="font-display text-xl text-cream">{handoffLine(p1Name, p2Name)}</p>
      <button
        type="button"
        onClick={onReady}
        className="mt-4 rounded-xl bg-ember px-8 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        I&apos;m {label} — ready
      </button>
    </motion.div>
  );
}
