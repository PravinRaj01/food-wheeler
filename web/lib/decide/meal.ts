import type { MealId, MealInfo } from "@/lib/decide/types";

/** The choices on the "Looking for" chip, in the order they're offered. */
export const MEAL_CHOICES: MealId[] = ["breakfast", "lunch", "dinner", "supper", "snack", "any"];

export const MEAL_LABELS: Record<MealId, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  supper: "Supper",
  snack: "Snack",
  any: "Anything",
};

/** The local hour (0-23) -> the meal someone is most likely after. Mirrors
 * the server's meals.meal_from_hour exactly - the chip shows this guess before
 * the server has been asked, so the two must agree (see meal.test.ts). */
export function mealFromHour(hour: number): MealId {
  if (hour >= 5 && hour <= 10) return "breakfast";
  if (hour >= 11 && hour <= 15) return "lunch";
  if (hour === 16) return "snack";
  if (hour >= 17 && hour <= 21) return "dinner";
  return "supper";
}

const FOR_PHRASE: Record<MealId, string | null> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
  supper: "supper",
  snack: "a snack",
  any: null,
};

const SOURCE_HINT: Record<MealInfo["source"], string> = {
  chosen: "your pick",
  text: "from what you typed",
  clock: "by the time of day",
  none: "",
};

/** "For lunch" plus where that came from ("by the time of day") so the
 * assumption is visible and explained - or null when no meal rule applied. */
export function mealCaption(meal?: MealInfo): { text: string; hint: string } | null {
  const phrase = meal ? FOR_PHRASE[meal.id] : null;
  if (!meal || !phrase) return null;
  return { text: `For ${phrase}`, hint: SOURCE_HINT[meal.source] };
}

/** "must have chicken" / "must have chicken + rice", or null. */
export function mustsCaption(musts?: string[]): string | null {
  if (!musts || musts.length === 0) return null;
  return `must have ${musts.join(" + ")}`;
}

/** "Nothing nearby clearly serves chicken - ..." for demands no place met. */
export function relaxedCaption(relaxed?: string[]): string | null {
  if (!relaxed || relaxed.length === 0) return null;
  const foods = relaxed.join(" or ");
  return `Nothing nearby clearly serves ${foods} — these are the closest fits.`;
}

// ---------------------------------------------------------------------------
// Meal from typed words - a mirror of the server's meals.meal_from_text, so
// the "Looking for" chip can show what the server WILL decide once both
// answers are in. Kept identical on purpose: both suites run the same cases
// from tests/fixtures/meal_text_cases.json (see meal.test.ts), so they can't
// drift apart silently. The server stays the source of truth - this only
// previews it, and the request still sends `meal` only when the couple picked.
// ---------------------------------------------------------------------------
const MEAL_WORDS: [MealId, RegExp][] = [
  ["breakfast", /\b(breakfast|brekkie|breakkie|brunch|sarapan)\b/g],
  ["lunch", /\b(lunch|lunchy|tengah hari)\b/g],
  ["dinner", /\b(dinner|dindin|din din)\b/g],
  ["supper", /\b(supper|late night|late-night|midnight|after midnight)\b/g],
  [
    "snack",
    /\b(snacks?|dessert|desserts|something sweet|sweet tooth|ice cream|cake|tea time|teatime|tea break|light bite)\b/g,
  ],
];
const NEGATIONS = new Set(["no", "not", "without", "avoid", "except"]);

function negated(text: string, start: number): boolean {
  const before = text.slice(0, start).split(/\s+/).filter(Boolean);
  return before.length > 0 && NEGATIONS.has(before[before.length - 1]);
}

/** The single meal the text asks for, or null if it names none - or several
 * (two partners asking for different things, "lunch then dessert"), where
 * picking one would override the other. */
export function mealFromText(text: string): MealId | null {
  const lower = (text || "").toLowerCase();
  const found = new Set<MealId>();
  for (const [meal, pattern] of MEAL_WORDS) {
    for (const m of lower.matchAll(pattern)) {
      if (!negated(lower, m.index ?? 0)) {
        found.add(meal);
        break;
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
}
