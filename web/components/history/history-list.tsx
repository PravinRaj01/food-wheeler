"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Drawer } from "vaul";
import { Check, Ellipsis, Navigation, Star, Trash2, X } from "lucide-react";
import { deleteDecision, deleteDecisions, deleteMatching, loadMoreDecisions, toggleFavourite } from "@/lib/actions/history";
import { clearOutbox } from "@/lib/sync/outbox";
import { formatDistance } from "@/lib/decide/distance";
import { hasActiveFilters, type HistoryFilters, type HistoryRow } from "@/lib/history/filters";
import { badgeLabel } from "@/lib/history/labels";
import {
  emptySelection,
  isAllLoadedSelected,
  selectAllLoaded,
  selectAllMatching,
  selectedCount,
  toggleRow,
  withLoadedRows,
  type Selection,
} from "@/lib/history/selection";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ToastStack } from "@/components/toast-stack";
import { DirectionsSheet } from "@/components/decide/directions-sheet";
import { ConfirmDrawer } from "@/components/history/confirm-drawer";

// Day headings depend on the viewer's own timezone, which the server (a
// different zone) can't know - so the grouped list only renders once mounted,
// the same server-can't-know pattern as lib/hooks/use-platform.ts.
const subscribeNoop = () => () => {};

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

type Confirm = { kind: "one"; row: HistoryRow } | { kind: "selected" } | null;

const plural = (n: number) => `${n} decision${n === 1 ? "" : "s"}`;

/** The round tick used in select mode. Purely visual - the row/bar around it
 * is the checkbox (role + aria-checked). */
function Tick({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-ember bg-ember text-ink" : "border-line-strong",
      )}
    >
      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

export function HistoryList({
  initialRows,
  initialCursor,
  total: initialTotal,
  filters,
  userId,
}: {
  initialRows: HistoryRow[];
  initialCursor: string | null;
  /** How many decisions the current view holds, loaded or not. */
  total: number;
  filters: HistoryFilters;
  userId: string;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const { toasts, toast } = useToast();
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuRow, setMenuRow] = useState<HistoryRow | null>(null);
  const [directionsRow, setDirectionsRow] = useState<HistoryRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection>(emptySelection);

  // With nothing narrowing the list, starred decisions are pinned above the
  // day sections (and were fetched separately by the page, so the timeline's
  // paging skips them). Any filter or search shows one flat list instead.
  const pinnedMode = filters.tab === "all" && !hasActiveFilters(filters);
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pinned = pinnedMode ? sorted.filter((r) => r.favourite) : [];
  const timeline = pinnedMode ? sorted.filter((r) => !r.favourite) : sorted;

  const loadedIds = rows.map((r) => r.id);
  const count = selectedCount(selection, total);
  const allLoaded = isAllLoadedSelected(selection, loadedIds);
  const moreThanLoaded = total > rows.length;
  // Deleting everything there is (no filter, All tab) is "clear history":
  // it also has to empty the local outbox so nothing re-syncs afterwards.
  const wholeHistory = filters.tab === "all" && !hasActiveFilters(filters);
  // The selection is the whole view - either "select all N" was chosen, or
  // every row is loaded and ticked. Either way it's deleted by the view's
  // filters rather than by id, so it can't miss a row the page never held
  // (or a stale demo row it hides) and, for the whole history, is a real clear.
  const wholeView = selection.allMatching || (allLoaded && !moreThanLoaded);

  function endSelecting() {
    setSelecting(false);
    setSelection(emptySelection);
  }

  async function onToggleFavourite(row: HistoryRow) {
    const before = rows;
    const beforeTotal = total;
    const next = !row.favourite;
    // In the Favourites tab, un-starring removes the row outright.
    const leavesView = filters.tab === "favourites" && !next;
    setRows((rs) => (leavesView ? rs.filter((r) => r.id !== row.id) : rs.map((r) => (r.id === row.id ? { ...r, favourite: next } : r))));
    if (leavesView) setTotal((t) => Math.max(0, t - 1));
    try {
      const res = await toggleFavourite(row.id, next);
      if (res.status !== "ok" || !res.changed) throw new Error("not saved");
    } catch {
      setRows(before);
      setTotal(beforeTotal);
      toast("Couldn't update that favourite - try again.");
    }
  }

  async function onConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "one") {
        const res = await deleteDecision(confirm.row.id);
        if (res.status !== "ok") throw new Error("not deleted");
        setRows((rs) => rs.filter((r) => r.id !== confirm.row.id));
        setTotal((t) => Math.max(0, t - 1));
        toast("Deleted.");
      } else if (wholeView) {
        // By filter, not by id - this reaches rows the page never loaded.
        const res = await deleteMatching({
          q: filters.q,
          cuisine: filters.cuisine,
          via: filters.via,
          favouritesOnly: filters.tab === "favourites",
        });
        if (res.status !== "ok") throw new Error("not deleted");
        // A decision still queued locally would otherwise sync straight
        // back into the account after this.
        if (wholeHistory) await clearOutbox(userId);
        setRows([]);
        setCursor(null);
        setTotal(0);
        toast(wholeHistory ? "History cleared." : `Deleted ${plural(res.deleted)}.`);
        endSelecting();
      } else {
        const ids = [...selection.ids];
        const res = await deleteDecisions(ids);
        if (res.status !== "ok") throw new Error("not deleted");
        setRows((rs) => rs.filter((r) => !selection.ids.has(r.id)));
        setTotal((t) => Math.max(0, t - res.deleted));
        toast(`Deleted ${plural(res.deleted)}.`);
        endSelecting();
      }
      setConfirm(null);
    } catch {
      toast("That didn't go through - try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onLoadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await loadMoreDecisions({
        q: filters.q,
        cuisine: filters.cuisine,
        via: filters.via,
        favouritesOnly: filters.tab === "favourites",
        excludeFavourites: pinnedMode,
        cursor,
      });
      if (res.status !== "ok") throw new Error("unauthorized");
      const seen = new Set(rows.map((r) => r.id));
      const fresh = res.rows.filter((r) => !seen.has(r.id));
      setRows((rs) => [...rs, ...fresh]);
      setCursor(res.nextCursor);
      // While "select all N" is on, rows that arrive are part of it.
      setSelection((sel) => withLoadedRows(sel, fresh.map((r) => r.id)));
    } catch {
      toast("Couldn't load more - try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (!mounted) {
    return <div className="mt-8 h-40 animate-pulse rounded-2xl bg-glass" aria-hidden />;
  }

  const groups = new Map<string, HistoryRow[]>();
  for (const row of timeline) {
    const key = dayLabel(row.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const rowBody = (row: HistoryRow) => (
    <>
      <p className="truncate text-sm font-medium text-cream">{row.winner.name}</p>
      <p className="mt-0.5 truncate text-xs text-cream/50">
        {row.winner.cuisine} · {formatDistance(row.winner)}
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-[11px]">
        <span className="rounded-full bg-[color-mix(in_oklab,var(--ember)_18%,transparent)] px-2 py-0.5 text-ember">
          {badgeLabel(row)}
        </span>
        <span className="text-cream/40">{timeLabel(row.createdAt)}</span>
      </p>
    </>
  );

  const renderRow = (row: HistoryRow) => {
    if (selecting) {
      const checked = selection.ids.has(row.id);
      return (
        <button
          key={row.id}
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => setSelection((sel) => toggleRow(sel, row.id, loadedIds))}
          className={cn(
            "glass flex w-full items-center gap-3.5 rounded-xl py-2 pr-4 pl-4 text-left transition-colors",
            checked && "ring-1 ring-ember",
          )}
        >
          <Tick checked={checked} />
          <div className="min-w-0 flex-1 py-1">{rowBody(row)}</div>
          {row.favourite && <Star className="h-4 w-4 shrink-0 fill-ember text-ember" aria-label="Favourite" />}
        </button>
      );
    }
    return (
      <div key={row.id} className="glass flex items-center gap-1 rounded-xl py-2 pr-1.5 pl-4">
        <Link href={`/history/${row.id}`} className="min-w-0 flex-1 py-1">
          {rowBody(row)}
        </Link>
        <button
          type="button"
          onClick={() => onToggleFavourite(row)}
          aria-pressed={row.favourite}
          aria-label={row.favourite ? "Remove from favourites" : "Add to favourites"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream/50 transition-colors hover:bg-glass"
        >
          <Star className={cn("h-5 w-5", row.favourite && "fill-ember text-ember")} />
        </button>
        <button
          type="button"
          onClick={() => setMenuRow(row)}
          aria-label={`More actions for ${row.winner.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream/50 transition-colors hover:bg-glass"
        >
          <Ellipsis className="h-5 w-5" />
        </button>
      </div>
    );
  };

  const selectedFavourites = rows.filter((r) => selection.ids.has(r.id) && r.favourite).length;
  const confirmCopy =
    confirm?.kind === "selected"
      ? wholeView && wholeHistory
        ? {
            title: "Clear all history?",
            description: "Every saved decision is removed from your account and this device. This can't be undone.",
            label: "Clear everything",
          }
        : {
            title: `Delete ${plural(count)}?`,
            description: `${count === 1 ? "It is" : "They are"} removed from your history.${
              selectedFavourites > 0 || (wholeView && filters.tab === "all")
                ? " Starred decisions in the selection go too."
                : ""
            } This can't be undone.`,
            label: "Delete",
          }
      : {
          title: "Delete this decision?",
          description: `${confirm?.kind === "one" ? confirm.row.winner.name : ""} is removed from your history. This can't be undone.`,
          label: "Delete",
        };

  return (
    <div className="mt-6">
      <ToastStack toasts={toasts} />

      {rows.length > 0 &&
        (selecting ? (
          // Sticky just below the app's own sticky header (h-14) so Select all
          // / Delete stay in reach however far down a long history is scrolled.
          <div className="sticky top-14 z-30 -mx-5 mb-4 border-b border-line bg-canvas/85 px-5 py-2.5 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={allLoaded}
                onClick={() => setSelection(allLoaded ? emptySelection : selectAllLoaded(loadedIds))}
                className="flex items-center gap-2.5 text-sm font-medium text-cream"
              >
                <Tick checked={allLoaded} />
                Select all
              </button>
              <span className="mr-auto text-xs text-cream/50" aria-live="polite">
                {count} selected
              </span>
              <button
                type="button"
                disabled={count === 0}
                onClick={() => setConfirm({ kind: "selected" })}
                className="flex items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <button type="button" onClick={endSelecting} className="text-sm text-cream/60">
                Done
              </button>
            </div>
            {allLoaded && moreThanLoaded && (
              <p className="mt-2 text-xs text-cream/60">
                {selection.allMatching ? (
                  <>
                    All {total} selected.{" "}
                    <button type="button" className="underline" onClick={() => setSelection(selectAllLoaded(loadedIds))}>
                      Only these {rows.length}
                    </button>
                  </>
                ) : (
                  <>
                    All {rows.length} loaded selected.{" "}
                    <button type="button" className="underline" onClick={() => setSelection(selectAllMatching(loadedIds))}>
                      Select all {total}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-cream/50">{plural(total)}</p>
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="rounded-full border border-line px-3 py-1 text-xs font-medium text-cream transition-colors hover:bg-glass"
            >
              Select
            </button>
          </div>
        ))}

      {rows.length === 0 && (
        <p className="mt-8 text-sm text-cream/50">
          {hasActiveFilters(filters) ? (
            <>
              Nothing matches that.{" "}
              <Link href="/history" className="underline">
                Clear filters
              </Link>
              .
            </>
          ) : filters.tab === "favourites" ? (
            "No favourites yet - tap the star on a decision to keep it here."
          ) : (
            <>
              No decisions yet.{" "}
              <Link href="/decide" className="underline">
                Go decide something
              </Link>
              .
            </>
          )}
        </p>
      )}

      <div className="space-y-8">
        {pinned.length > 0 && (
          <section aria-label="Favourites">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-cream/40 uppercase">
              <Star className="h-3 w-3 fill-current" /> Favourites
            </p>
            <div className="space-y-2">{pinned.map(renderRow)}</div>
          </section>
        )}
        {Array.from(groups.entries()).map(([day, dayRows]) => (
          <section key={day}>
            <p className="mb-3 text-xs font-medium tracking-wide text-cream/40 uppercase">{day}</p>
            <div className="space-y-2">{dayRows.map(renderRow)}</div>
          </section>
        ))}
      </div>

      {cursor && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-6 w-full rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}

      {/* Per-row actions. One drawer for the whole list (driven by which row
          it was opened for), not one per row. */}
      <Drawer.Root open={menuRow !== null} onOpenChange={(open) => !open && setMenuRow(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-surface p-6 text-surface-fg outline-none">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mx-auto flex max-w-sm flex-col gap-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Drawer.Title className="font-display truncate text-lg font-semibold">{menuRow?.winner.name}</Drawer.Title>
                <Drawer.Close className="text-surface-fg/60" aria-label="Close">
                  <X className="h-5 w-5" />
                </Drawer.Close>
              </div>
              <Drawer.Description className="sr-only">Actions for this decision</Drawer.Description>
              <button
                type="button"
                onClick={() => {
                  if (menuRow) void onToggleFavourite(menuRow);
                  setMenuRow(null);
                }}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-medium"
              >
                <Star className={cn("h-4 w-4", menuRow?.favourite && "fill-current")} />
                {menuRow?.favourite ? "Remove from favourites" : "Add to favourites"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirectionsRow(menuRow);
                  setMenuRow(null);
                }}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-medium"
              >
                <Navigation className="h-4 w-4" /> Directions
              </button>
              <button
                type="button"
                onClick={() => {
                  if (menuRow) setConfirm({ kind: "one", row: menuRow });
                  setMenuRow(null);
                }}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-medium"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {directionsRow && (
        <DirectionsSheet
          open
          onOpenChange={(open) => !open && setDirectionsRow(null)}
          lat={directionsRow.winner.lat}
          lng={directionsRow.winner.lng}
          name={directionsRow.winner.name}
        />
      )}

      <ConfirmDrawer
        open={confirm !== null}
        onOpenChange={(open) => !open && !busy && setConfirm(null)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.label}
        busy={busy}
        onConfirm={onConfirm}
      />
    </div>
  );
}
