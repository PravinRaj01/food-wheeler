import { describe, expect, it } from "vitest";
import { MEAL_CHOICES, MEAL_LABELS, mealCaption, mealFromHour, mustsCaption, relaxedCaption } from "./meal";

describe("mealFromHour", () => {
  // Must match the server's meals.meal_from_hour - see tests/test_meals.py's
  // test_meal_from_hour_bands, which uses this same table.
  it.each([
    [5, "breakfast"], [10, "breakfast"], [11, "lunch"], [15, "lunch"], [16, "snack"],
    [17, "dinner"], [21, "dinner"], [22, "supper"], [0, "supper"], [4, "supper"],
  ] as const)("hour %i is %s", (hour, meal) => {
    expect(mealFromHour(hour)).toBe(meal);
  });

  it("covers every hour of the day with a real meal choice", () => {
    for (let h = 0; h < 24; h++) expect(MEAL_CHOICES).toContain(mealFromHour(h));
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
