import { describe, expect, it } from "vitest";
import {
  emptySelection,
  isAllLoadedSelected,
  selectAllLoaded,
  selectAllMatching,
  selectedCount,
  toggleRow,
  withLoadedRows,
} from "./selection";

const loaded = ["a", "b", "c"];

describe("history selection", () => {
  it("toggles single rows on and off", () => {
    const one = toggleRow(emptySelection, "b", loaded);
    expect([...one.ids]).toEqual(["b"]);
    expect(toggleRow(one, "b", loaded).ids.size).toBe(0);
    // never mutates the previous selection
    expect(emptySelection.ids.size).toBe(0);
  });

  it("select all ticks every loaded row, and knows when they all are", () => {
    const sel = selectAllLoaded(loaded);
    expect(isAllLoadedSelected(sel, loaded)).toBe(true);
    expect(sel.allMatching).toBe(false);
    expect(isAllLoadedSelected(toggleRow(sel, "a", loaded), loaded)).toBe(false);
  });

  it("an empty list is never 'all selected'", () => {
    expect(isAllLoadedSelected(emptySelection, [])).toBe(false);
  });

  it("counts loaded rows normally, but the whole matching total in all-matching mode", () => {
    expect(selectedCount(selectAllLoaded(loaded), 34)).toBe(3);
    expect(selectedCount(selectAllMatching(loaded), 34)).toBe(34);
  });

  it("unticking one row in all-matching mode drops to the loaded rows minus it", () => {
    const sel = toggleRow(selectAllMatching(loaded), "b", loaded);
    expect(sel.allMatching).toBe(false);
    expect([...sel.ids].sort()).toEqual(["a", "c"]);
    expect(selectedCount(sel, 34)).toBe(2);
  });

  it("rows loaded while all-matching is on join the selection; otherwise they don't", () => {
    const matching = withLoadedRows(selectAllMatching(loaded), ["d", "e"]);
    expect([...matching.ids].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(matching.allMatching).toBe(true);
    const plain = selectAllLoaded(loaded);
    expect(withLoadedRows(plain, ["d"])).toBe(plain);
  });
});
