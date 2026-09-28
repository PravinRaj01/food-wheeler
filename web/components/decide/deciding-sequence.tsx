"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MapPin, Soup, MessageSquareText, Scale, Sparkles } from "lucide-react";

// A small deck of "what it's doing" cards, cycling while the actual
// /api/decide request is in flight. Purely decorative - there's no real
// per-step progress to report (the request is one round trip), but cycling
// through the stages an AI "System 1" decision actually goes through
// (candidates -> cuisine -> both partners' text -> comparing -> ranking)
// reads as "it's genuinely working through this" rather than a bare spinner.
const STEPS = [
  { icon: MapPin, text: "Scanning nearby spots…" },
  { icon: Soup, text: "Checking cuisines…" },
  { icon: MessageSquareText, text: "Weighing what you both said…" },
  { icon: Scale, text: "Comparing the options…" },
  { icon: Sparkles, text: "Almost ready…" },
];

const STEP_MS = 850;

export function DecidingSequence() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const step = STEPS[index];
  const Icon = step.icon;

  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <div className="relative h-28 w-64">
        {/* A soft pulsing glow behind the card stack - just enough motion to
            read as "working" even in the instant between card swaps. */}
        <motion.div
          aria-hidden
          animate={{ scale: [1, 1.15, 1], opacity: [0.25, 0.4, 0.25] }}
          transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-[2rem] bg-ember blur-2xl"
        />
        <AnimatePresence mode="popLayout">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 48, rotate: 10, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, x: -48, rotate: -10, scale: 0.92 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.5 }}
            className="glass absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-2xl"
          >
            <Icon className="h-6 w-6 text-ember" />
            <p className="text-sm text-cream/75">{step.text}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex gap-1.5" role="status" aria-live="polite">
        <span className="sr-only">{step.text}</span>
        {STEPS.map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              i === index ? "bg-ember" : "bg-glass-strong"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
