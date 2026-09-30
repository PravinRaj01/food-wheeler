"use client";

import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { MealId } from "@/lib/decide/types";
import { MEAL_CHOICES, MEAL_LABELS, mealFromHour } from "@/lib/decide/meal";
import { cn } from "@/lib/utils";

// The local hour only exists in the browser (the server renders in another
// timezone), so it comes from an external-store read that is null during
// server render and hydration - the same server-can't-know pattern as
// lib/hooks/use-platform.ts - and refreshes each minute so a round left open
// across 11:00 or 17:00 doesn't keep the old guess.
function subscribeMinute(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}
const getHour = (): number | null => new Date().getHours();
const getServerHour = (): number | null => null;

export function useLocalHour(): number | null {
  return useSyncExternalStore(subscribeMinute, getHour, getServerHour);
}

const chip = (active: boolean) =>
  cn(
    "shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
    active
      ? "border-ember bg-[color-mix(in_oklab,var(--ember)_16%,transparent)] text-ember"
      : "border-line bg-glass text-cream/70 hover:text-cream",
  );

/** "Looking for: Lunch" - what kind of meal this is, so the shortlist can
 * leave out places that don't suit it (no ice-cream shop at lunch). It starts
 * from the time of day; the couple can pick one, or say it in their text
 * ("something sweet") and that wins. Tapping opens the choices inline. */
export function MealChip({
  value,
  typedMeal,
  onChange,
}: {
  /** The couple's own pick, or null to go by what they said and the time. */
  value: MealId | null;
  /** The meal their typed words ask for - what the server will use over the
   * clock. The page only passes it once BOTH answers are sealed: until then
   * the chip changing would give away part of the first partner's answer. */
  typedMeal: MealId | null;
  onChange: (meal: MealId | null) => void;
}) {
  const hour = useLocalHour();
  const [open, setOpen] = useState(false);
  const guess = hour === null ? null : mealFromHour(hour);
  // What "Auto" resolves to: typed words beat the clock, exactly as the
  // server decides it (see meals.detect_meal).
  const auto = typedMeal ?? guess;
  const shown = value ?? auto;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-cream/60 transition-colors hover:text-cream"
      >
        <span>Looking for:</span>
        <span className="rounded-full border border-line bg-glass px-2.5 py-1 font-medium text-cream">
          {shown ? MEAL_LABELS[shown] : "…"}
          {value === null && shown && (
            <span className="ml-1 font-normal text-cream/40">· {typedMeal ? "from what you said" : "auto"}</span>
          )}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 pt-2.5">
              <button
                type="button"
                aria-pressed={value === null}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={chip(value === null)}
              >
                Auto{auto ? ` (${MEAL_LABELS[auto]})` : ""}
              </button>
              {MEAL_CHOICES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={value === m}
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={chip(value === m)}
                >
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="pt-2 text-[11px] text-cream/40">
              Saying it in your answer — &ldquo;lunch&rdquo;, &ldquo;something sweet&rdquo; — counts too.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
