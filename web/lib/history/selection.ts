/** Which History rows are ticked in select mode.
 *
 * The list is paged, so "select all" is really two things: every row loaded
 * so far, and every row matching the current search/filters - including ones
 * not fetched yet. `allMatching` is the second; `ids` always holds at least
 * the loaded rows that are ticked, so rows render correctly either way. */
export interface Selection {
  ids: ReadonlySet<string>;
  allMatching: boolean;
}

export const emptySelection: Selection = { ids: new Set(), allMatching: false };

export function selectAllLoaded(loadedIds: string[]): Selection {
  return { ids: new Set(loadedIds), allMatching: false };
}

/** Everything matching the view, loaded or not. The server is asked to delete
 * by filter (not by id) when this is set, so unloaded rows are covered too. */
export function selectAllMatching(loadedIds: string[]): Selection {
  return { ids: new Set(loadedIds), allMatching: true };
}

export function toggleRow(sel: Selection, id: string, loadedIds: string[]): Selection {
  if (sel.allMatching && sel.ids.has(id)) {
    // Unticking one row means "everything except this" - which can no longer be
    // expressed as a filter, so fall back to exactly the loaded rows minus it.
    return { ids: new Set(loadedIds.filter((x) => x !== id)), allMatching: false };
  }
  const ids = new Set(sel.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, allMatching: sel.allMatching };
}

/** Rows that just loaded while "all matching" is on are part of it. */
export function withLoadedRows(sel: Selection, newIds: string[]): Selection {
  if (!sel.allMatching || newIds.length === 0) return sel;
  return { ids: new Set([...sel.ids, ...newIds]), allMatching: true };
}

export const isAllLoadedSelected = (sel: Selection, loadedIds: string[]): boolean =>
  loadedIds.length > 0 && loadedIds.every((id) => sel.ids.has(id));

/** The number to show and to confirm against. `total` is the count of rows
 * matching the view (loaded or not). */
export const selectedCount = (sel: Selection, total: number): number => (sel.allMatching ? total : sel.ids.size);
