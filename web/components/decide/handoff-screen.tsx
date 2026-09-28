"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { Smartphone } from "lucide-react";

export function HandoffScreen({ onDone, durationMs = 900 }: { onDone: () => void; durationMs?: number }) {
  useEffect(() => {
    const id = setTimeout(onDone, durationMs);
    return () => clearTimeout(id);
  }, [onDone, durationMs]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--orange-3)] text-center"
    >
      <Smartphone className="h-10 w-10 text-cream/70" />
      <p className="font-display text-xl text-cream">Hand the phone to Partner Two</p>
    </motion.div>
  );
}
