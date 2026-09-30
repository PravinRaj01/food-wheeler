import { redirect } from "next/navigation";
import { getUserIdOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { countDecisionsForUser, listDecisionsForUser } from "@/lib/db/queries";
import { filtersToSearch, hasActiveFilters, parseHistoryFilters, type HistoryRow } from "@/lib/history/filters";
import { HistoryControls } from "@/components/history/history-controls";
import { HistoryList } from "@/components/history/history-list";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Middleware already protects this route (see lib/auth.config.ts), but a
  // server component that touches user data should never trust that alone.
  const userId = await getUserIdOrNull();
  if (!userId) redirect("/login");

  const filters = parseHistoryFilters(await searchParams);
  const db = getDb();
  const query = { q: filters.q, cuisine: filters.cuisine, via: filters.via };

  // How many decisions the current view holds (loaded or not) - what
  // "select all N" in the list refers to. Same conditions as the list itself.
  const totalPromise = countDecisionsForUser(db, userId, { ...query, favouritesOnly: filters.tab === "favourites" });

  let initialRows: HistoryRow[];
  let initialCursor: string | null;
  if (filters.tab === "favourites") {
    ({ rows: initialRows, nextCursor: initialCursor } = await listDecisionsForUser(db, userId, {
      ...query,
      favouritesOnly: true,
    }));
  } else if (hasActiveFilters(filters)) {
    // Searching or filtering shows one flat list, starred rows included.
    ({ rows: initialRows, nextCursor: initialCursor } = await listDecisionsForUser(db, userId, query));
  } else {
    // Unfiltered "All": starred decisions are pinned above the day sections,
    // so the paged timeline below skips them (see HistoryList).
    const [favourites, timeline] = await Promise.all([
      listDecisionsForUser(db, userId, { favouritesOnly: true, limit: 50 }),
      listDecisionsForUser(db, userId, { excludeFavourites: true }),
    ]);
    initialRows = [...favourites.rows, ...timeline.rows];
    initialCursor = timeline.nextCursor;
  }

  const total = await totalPromise;

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cream/50">Past decisions</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-cream">History</h1>

      <HistoryControls filters={filters} />
      {/* Keyed on the filters so a new search or chip gives a fresh list
          (its rows and paging cursor are state seeded from these props) -
          the controls above are deliberately NOT keyed, so typing keeps focus. */}
      <HistoryList
        key={filtersToSearch(filters)}
        initialRows={initialRows}
        initialCursor={initialCursor}
        total={total}
        filters={filters}
        userId={userId}
      />
    </div>
  );
}
