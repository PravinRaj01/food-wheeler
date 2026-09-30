import { and, count, desc, eq, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { decisions, preferences } from "./schema";
import type { DecisionPayload } from "@/lib/validation/decision";
import { CUISINES } from "@/lib/decide/cuisines";
import { REASONS_BY_VIA, type ChosenVia } from "@/lib/history/labels";
import type { HistoryRow } from "@/lib/history/filters";

/** Upsert on (user_id, client_id) - a retried push (or two tabs syncing the
 * same entry) can never create a duplicate row, only update it. */
export async function upsertDecision(db: Db, userId: string, input: DecisionPayload) {
  const values = {
    userId,
    clientId: input.clientId,
    partner1Text: input.partner1Text,
    partner2Text: input.partner2Text,
    engine: input.engine,
    confidence: input.confidence,
    reason: input.reason,
    rank: input.rank ?? null,
    shortlistSize: input.shortlistSize ?? null,
    radiusKm: input.radiusKm,
    source: input.source,
    winner: input.winner,
    runnerUps: input.runnerUps,
    tiebreakers: input.tiebreakers,
  };
  const [row] = await db
    .insert(decisions)
    .values(values)
    .onConflictDoUpdate({
      target: [decisions.userId, decisions.clientId],
      set: {
        partner1Text: values.partner1Text,
        partner2Text: values.partner2Text,
        engine: values.engine,
        confidence: values.confidence,
        reason: values.reason,
        rank: values.rank,
        shortlistSize: values.shortlistSize,
        radiusKm: values.radiusKm,
        source: values.source,
        winner: values.winner,
        runnerUps: values.runnerUps,
        tiebreakers: values.tiebreakers,
      },
    })
    .returning({ id: decisions.id });
  return row;
}

export const HISTORY_PAGE_SIZE = 20;

export interface ListOptions {
  limit?: number;
  /** Opaque keyset cursor from a previous page (see encodeCursor). */
  cursor?: string | null;
  /** Matches the place's name or either partner's words. */
  q?: string;
  /** A CUISINES label ("Indian") - resolved to its needles here, never
   * trusting client-supplied patterns. */
  cuisine?: string | null;
  via?: ChosenVia | null;
  favouritesOnly?: boolean;
  excludeFavourites?: boolean;
}

export interface HistoryPage {
  rows: HistoryRow[];
  nextCursor: string | null;
}

/** Escapes LIKE's own wildcards so a search for "100%" or "a_b" is literal. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Keyset paging on (created_at, id) - stable while rows are added or
// deleted, unlike OFFSET, and served by decisions_user_created_idx. JS Dates
// are millisecond precision against Postgres's microseconds, which can only
// matter for two rows created in the same millisecond - not a real case for
// one couple's decisions.
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const createdAt = new Date(iso);
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

export function toHistoryRow(row: typeof decisions.$inferSelect): HistoryRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    winner: row.winner,
    reason: row.reason,
    rank: row.rank,
    shortlistSize: row.shortlistSize,
    favourite: row.favourite,
  };
}

/** Everything that narrows the caller's history to what the UI is showing -
 * shared by paging, counting and delete-by-filter, so "what I see", "how many
 * there are" and "what gets deleted" can never drift apart. Every condition is
 * ANDed onto user_id = the verified session user, so no filter combination
 * can ever reach another user's rows. (The cursor is paging only, not here.) */
function filterConditions(userId: string, opts: ListOptions): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [
    eq(decisions.userId, userId),
    // Demo-era rows (source "mock") are stale test data from before
    // location enforcement existed - not a decision the couple can revisit.
    ne(decisions.source, "mock"),
  ];

  if (opts.favouritesOnly) conditions.push(eq(decisions.favourite, true));
  if (opts.excludeFavourites) conditions.push(eq(decisions.favourite, false));
  if (opts.via) conditions.push(inArray(decisions.reason, REASONS_BY_VIA[opts.via]));

  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      or(
        ilike(sql`${decisions.winner}->>'name'`, pattern),
        ilike(decisions.partner1Text, pattern),
        ilike(decisions.partner2Text, pattern),
      ),
    );
  }

  const needles = CUISINES.find((c) => c.label === opts.cuisine)?.needles;
  if (needles?.length) {
    conditions.push(or(...needles.map((n) => ilike(sql`${decisions.winner}->>'cuisine'`, `%${escapeLike(n)}%`))));
  }
  return conditions;
}

/** One page of the caller's own decisions, newest first. */
export async function listDecisionsForUser(db: Db, userId: string, opts: ListOptions = {}): Promise<HistoryPage> {
  const limit = opts.limit ?? HISTORY_PAGE_SIZE;
  const conditions = filterConditions(userId, opts);

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cursor) {
    conditions.push(
      or(
        lt(decisions.createdAt, cursor.createdAt),
        and(eq(decisions.createdAt, cursor.createdAt), lt(decisions.id, cursor.id)),
      ),
    );
  }

  const rows = await db
    .select()
    .from(decisions)
    .where(and(...conditions))
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    rows: page.map(toHistoryRow),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** How many decisions match - what "select all N" refers to. */
export async function countDecisionsForUser(db: Db, userId: string, opts: ListOptions = {}): Promise<number> {
  const [row] = await db.select({ n: count() }).from(decisions).where(and(...filterConditions(userId, opts)));
  return row?.n ?? 0;
}

export async function getDecisionForUser(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.userId, userId), eq(decisions.id, id)))
    .limit(1);
  return row ?? null;
}

/** Scoped to the caller's own row: an id belonging to someone else matches
 * nothing and reports false, exactly like an id that doesn't exist. */
export async function deleteDecisionForUser(db: Db, userId: string, id: string): Promise<boolean> {
  const gone = await db
    .delete(decisions)
    .where(and(eq(decisions.userId, userId), eq(decisions.id, id)))
    .returning({ id: decisions.id });
  return gone.length > 0;
}

export async function setFavourite(db: Db, userId: string, id: string, favourite: boolean): Promise<boolean> {
  const updated = await db
    .update(decisions)
    .set({ favourite })
    .where(and(eq(decisions.userId, userId), eq(decisions.id, id)))
    .returning({ id: decisions.id });
  return updated.length > 0;
}

/** Several of the caller's own rows at once. Ids that aren't theirs (or don't
 * exist) match nothing and simply aren't counted. */
export async function deleteDecisionsForUser(db: Db, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const gone = await db
    .delete(decisions)
    .where(and(eq(decisions.userId, userId), inArray(decisions.id, ids)))
    .returning({ id: decisions.id });
  return gone.length;
}

/** Deletes everything matching the view - the "select all N matching" case,
 * which reaches rows the page never loaded. With nothing narrowing it, that is
 * the whole history (stale demo rows included, which the list hides). A
 * cuisine label that isn't a known one deletes NOTHING: the list treats it as
 * "no filter", which for a destructive call would mean everything. */
export async function deleteMatchingForUser(db: Db, userId: string, opts: ListOptions = {}): Promise<number> {
  if (opts.cuisine && !CUISINES.some((c) => c.label === opts.cuisine)) return 0;
  const unfiltered = !opts.q?.trim() && !opts.cuisine && !opts.via && !opts.favouritesOnly;
  const where = unfiltered ? eq(decisions.userId, userId) : and(...filterConditions(userId, opts));
  const gone = await db.delete(decisions).where(where).returning({ id: decisions.id });
  return gone.length;
}

export async function deleteAllDecisionsForUser(db: Db, userId: string) {
  await db.delete(decisions).where(eq(decisions.userId, userId));
}

export async function getPreferences(db: Db, userId: string) {
  const [row] = await db.select().from(preferences).where(eq(preferences.userId, userId)).limit(1);
  return row ?? null;
}

export async function upsertPreferences(
  db: Db,
  userId: string,
  values: Partial<Omit<typeof preferences.$inferInsert, "userId">>,
) {
  await db
    .insert(preferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: preferences.userId, set: values });
}
