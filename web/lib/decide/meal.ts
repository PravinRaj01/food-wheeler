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
