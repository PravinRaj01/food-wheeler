import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEAL_CHOICES,
  MEAL_LABELS,
  mealCaption,
  mealFromHour,
  mealFromText,
  mustsCaption,
  relaxedCaption,
} from "./meal";

// The same cases tests/test_meals.py runs against the server's meals.py - the
// chip previews what the server will decide, so the two must agree.
const cases = JSON.parse(
  // Resolved from the working directory (web/, where `npm test` runs): under the happy-dom
  // test environment import.meta.url is not a file URL.
  readFileSync(resolve(process.cwd(), "..", "tests", "fixtures", "meal_text_cases.json"), "utf-8"),
) as { text: { text: string; meal: string | null }[]; hours: [number, string][] };

describe("mealFromHour", () => {
  it.each(cases.hours)("hour %i is %s", (hour, meal) => {
    expect(mealFromHour(hour)).toBe(meal);
  });

  it("covers every hour of the day with a real meal choice", () => {
    for (let h = 0; h < 24; h++) expect(MEAL_CHOICES).toContain(mealFromHour(h));
  });
});

describe("mealFromText", () => {
  it.each(cases.text.map((c) => [c.text, c.meal] as const))("%j -> %s", (text, meal) => {
    expect(mealFromText(text)).toBe(meal);
  });
});

describe("labels", () => {
  it("has a label for every choice, with Anything last", () => {
    for (const m of MEAL_CHOICES) expect(MEAL_LABELS[m]).toBeTruthy();
    expect(MEAL_CHOICES[MEAL_CHOICES.length - 1]).toBe("any");
  });
});

describe("mealCaption", () => {
  it("says what it assumed and why", () => {
    expect(mealCaption({ id: "lunch", source: "clock" })).toEqual({ text: "For lunch", hint: "by the time of day" });
    expect(mealCaption({ id: "snack", source: "text" })).toEqual({ text: "For a snack", hint: "from what you typed" });
    expect(mealCaption({ id: "dinner", source: "chosen" })).toEqual({ text: "For dinner", hint: "your pick" });
  });

  it("says nothing when no meal rule applied", () => {
    expect(mealCaption({ id: "any", source: "none" })).toBeNull();
    expect(mealCaption({ id: "any", source: "chosen" })).toBeNull();
    expect(mealCaption(undefined)).toBeNull();
  });
});

describe("musts captions", () => {
  it("lists what was demanded", () => {
    expect(mustsCaption(["chicken"])).toBe("must have chicken");
    expect(mustsCaption(["chicken", "rice"])).toBe("must have chicken + rice");
    expect(mustsCaption([])).toBeNull();
    expect(mustsCaption(undefined)).toBeNull();
  });

  it("warns when nothing nearby clearly meets a demand", () => {
    expect(relaxedCaption(["chicken"])).toContain("Nothing nearby clearly serves chicken");
    expect(relaxedCaption(["pizza", "seafood"])).toContain("pizza or seafood");
    expect(relaxedCaption([])).toBeNull();
    expect(relaxedCaption(undefined)).toBeNull();
  });
});
