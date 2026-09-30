"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Drawer } from "vaul";
import { Ellipsis, Navigation, Star, Trash2, X } from "lucide-react";
import { deleteDecision, clearHistory, loadMoreDecisions, toggleFavourite } from "@/lib/actions/history";
import { clearOutbox } from "@/lib/sync/outbox";
import { formatDistance } from "@/lib/decide/distance";
import { hasActiveFilters, type HistoryFilters, type HistoryRow } from "@/lib/history/filters";
import { badgeLabel } from "@/lib/history/labels";
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

type Confirm = { kind: "one"; row: HistoryRow } | { kind: "all" } | null;

export function HistoryList({
  initialRows,
  initialCursor,
  filters,
  userId,
}: {
  initialRows: HistoryRow[];
  initialCursor: string | null;
  filters: HistoryFilters;
  userId: string;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const { toasts, toast } = useToast();
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuRow, setMenuRow] = useState<HistoryRow | null>(null);
  const [directionsRow, setDirectionsRow] = useState<HistoryRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  // With nothing narrowing the list, starred decisions are pinned above the
  // day sections (and were fetched separately by the page, so the timeline's
  // paging skips them). Any filter or search shows one flat list instead.
  const pinnedMode = filters.tab === "all" && !hasActiveFilters(filters);
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pinned = pinnedMode ? sorted.filter((r) => r.favourite) : [];
  const timeline = pinnedMode ? sorted.filter((r) => !r.favourite) : sorted;

  async function onToggleFavourite(row: HistoryRow) {
    const before = rows;
    const next = !row.favourite;
    // In the Favourites tab, un-starring removes the row outright.
    setRows((rs) =>
      filters.tab === "favourites" && !next ? rs.filter((r) => r.id !== row.id) : rs.map((r) => (r.id === row.id ? { ...r, favourite: next } : r)),
    );
    try {
      const res = await toggleFavourite(row.id, next);
      if (res.status !== "ok" || !res.changed) throw new Error("not saved");
    } catch {
      setRows(before);
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
        toast("Deleted.");
      } else {
        const res = await clearHistory();
        if (res.status !== "ok") throw new Error("not cleared");
        // A decision still queued locally would otherwise sync straight
        // back into the account after this.
        await clearOutbox(userId);
        setRows([]);
        setCursor(null);
        toast("History cleared.");
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
      setRows((rs) => {
        const seen = new Set(rs.map((r) => r.id));
        return [...rs, ...res.rows.filter((r) => !seen.has(r.id))];
      });
      setCursor(res.nextCursor);
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

  const renderRow = (row: HistoryRow) => (
    <div key={row.id} className="glass flex items-center gap-1 rounded-xl py-2 pr-1.5 pl-4">
      <Link href={`/history/${row.id}`} className="min-w-0 flex-1 py-1">
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

  return (
    <div className="mt-6">
      <ToastStack toasts={toasts} />

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

      {rows.length > 0 && (
        <button
          type="button"
          onClick={() => setConfirm({ kind: "all" })}
          className="mt-8 flex w-full items-center justify-center gap-1.5 py-2 text-xs text-cream/40 underline"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all history
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
        title={confirm?.kind === "all" ? "Clear all history?" : "Delete this decision?"}
        description={
          confirm?.kind === "all"
            ? "Every saved decision is removed from your account and this device. This can't be undone."
            : `${confirm?.kind === "one" ? confirm.row.winner.name : ""} is removed from your history. This can't be undone.`
        }
        confirmLabel={confirm?.kind === "all" ? "Clear everything" : "Delete"}
        busy={busy}
        onConfirm={onConfirm}
      />
    </div>
  );
}
