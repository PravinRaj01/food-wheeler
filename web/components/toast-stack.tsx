"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ToastItem } from "@/lib/hooks/use-toast";

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-4 left-1/2 z-100 flex w-[min(90vw,26rem)] -translate-x-1/2 flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl px-4 py-2.5 text-center text-sm text-cream"
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
