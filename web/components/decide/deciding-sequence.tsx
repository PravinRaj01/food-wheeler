"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MapPin, Soup, MessageSquareText, Scale, Sparkles } from "lucide-react";

// The status line cycling below the diagram - purely decorative captioning,
// same wording as before.
const STEPS = [
  { icon: MapPin, text: "Scanning nearby spots…" },
  { icon: Soup, text: "Checking cuisines…" },
  { icon: MessageSquareText, text: "Weighing what you both said…" },
  { icon: Scale, text: "Comparing the options…" },
  { icon: Sparkles, text: "Almost ready…" },
];
const STEP_MS = 1100;

// The diagram itself: one source node branches out to 3 candidate nodes,
// which then converge into a single final node - "considering several
// options, then landing on one" as a continuous, fully declarative loop
// (framer-motion keyframe arrays + repeat: Infinity, no JS timer driving
// it). Coordinates are in a 240x170 viewBox.
const SOURCE = { x: 120, y: 16 };
const BRANCHES = [
  { x: 50, y: 85 },
  { x: 120, y: 85 },
  { x: 190, y: 85 },
];
const FINAL = { x: 120, y: 152 };

const CYCLE_S = 2.6;
// Fractions of one cycle, shared by every element's keyframe `times` array
// so the whole diagram stays in lockstep.
const T = {
  branchOutStart: 0,
  branchOutEnd: 0.28,
  hold: 0.4,
  convergeStart: 0.42,
  convergeEnd: 0.68,
  settle: 0.8,
  fadeStart: 0.92,
};

function outPath(to: { x: number; y: number }) {
  return `M ${SOURCE.x} ${SOURCE.y} Q ${(SOURCE.x + to.x) / 2} ${(SOURCE.y + to.y) / 2 - 10} ${to.x} ${to.y}`;
}
function inPath(from: { x: number; y: number }) {
  return `M ${from.x} ${from.y} Q ${(from.x + FINAL.x) / 2} ${(from.y + FINAL.y) / 2 + 10} ${FINAL.x} ${FINAL.y}`;
}

export function DecidingSequence() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const step = STEPS[index];
  const Icon = step.icon;

  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <svg viewBox="0 0 240 170" className="h-44 w-full max-w-[280px]">
        {BRANCHES.map((b, i) => {
          const delay = i * 0.05;
          return (
            <motion.path
              key={`out-${i}`}
              d={outPath(b)}
              fill="none"
              stroke="var(--ember)"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={false}
              animate={{
                pathLength: [0, 1, 1, 1, 1],
                opacity: [0, 0.7, 0.7, 0.5, 0],
              }}
              transition={{
                duration: CYCLE_S,
                repeat: Infinity,
                ease: "easeInOut",
                delay,
                times: [T.branchOutStart, T.branchOutEnd, T.hold, T.settle, 1],
              }}
            />
          );
        })}
        {BRANCHES.map((b, i) => {
          const delay = i * 0.05;
          return (
            <motion.path
              key={`in-${i}`}
              d={inPath(b)}
              fill="none"
              stroke="var(--ember)"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={false}
              animate={{
                pathLength: [0, 0, 1, 1, 1],
                opacity: [0, 0, 0.8, 0.5, 0],
              }}
              transition={{
                duration: CYCLE_S,
                repeat: Infinity,
                ease: "easeInOut",
                delay,
                times: [T.convergeStart, T.convergeStart, T.convergeEnd, T.settle, 1],
              }}
            />
          );
        })}

        <motion.circle
          cx={SOURCE.x}
          cy={SOURCE.y}
          r={6}
          fill="var(--ember)"
          animate={{ scale: [0.9, 1.15, 1, 1, 0.9], opacity: [0.6, 1, 0.8, 0.5, 0.6] }}
          transition={{ duration: CYCLE_S, repeat: Infinity, ease: "easeInOut", times: [0, T.branchOutEnd, T.hold, T.settle, 1] }}
        />
        {BRANCHES.map((b, i) => (
          <motion.circle
            key={`node-${i}`}
            cx={b.x}
            cy={b.y}
            r={5}
            fill="var(--peach)"
            initial={false}
            animate={{ scale: [0, 1, 1, 1, 0], opacity: [0, 1, 1, 0.6, 0] }}
            transition={{
              duration: CYCLE_S,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.05,
              times: [T.branchOutStart, T.branchOutEnd, T.hold, T.settle, 1],
            }}
          />
        ))}
        <motion.circle
          cx={FINAL.x}
          cy={FINAL.y}
          r={7}
          fill="var(--ember)"
          initial={false}
          animate={{ scale: [0, 0, 1, 1.3, 0], opacity: [0, 0, 1, 1, 0] }}
          transition={{
            duration: CYCLE_S,
            repeat: Infinity,
            ease: "easeInOut",
            times: [T.convergeStart, T.convergeStart, T.convergeEnd, T.settle, 1],
          }}
        />
      </svg>

      <div className="relative h-6">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            role="status"
            aria-live="polite"
            className="absolute inset-x-0 flex items-center justify-center gap-2 text-sm text-cream/70"
          >
            <Icon className="h-4 w-4 text-ember" />
            {step.text}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
