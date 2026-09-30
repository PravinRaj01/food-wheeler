import { openDB, type IDBPDatabase } from "idb";
import type { DecisionPayload } from "@/lib/validation/decision";

// Local-first outbox. A decision is written to IndexedDB first and returns
// immediately; a background flush pushes it to the server. The UI never
// waits on the network, and a save made offline (or as a guest) survives
// reloads. Ported from the Bill-a project's bill outbox.
//
// Delivery is at-least-once, made safe by the server upserting on
// (user_id, client_id): pushing the same entry twice yields one row.

export interface OutboxEntry {
  clientId: string;
  /** Who was signed in when the decision was made; null = guest. Only that
   *  user (or, for guest entries, whoever logs in next) may flush it - so
   *  logging out with unsynced decisions can never leak them into someone
   *  else's account. */
  ownerId: string | null;
  payload: DecisionPayload;
  /** Bumped on every write. A flush only deletes an entry whose rev it
   *  pushed, so an edit made mid-flight is not silently thrown away. */
  rev: number;
  status: "pending" | "failed";
  createdAt: number;
  lastError?: string;
}

export type PushFn = (
  batch: DecisionPayload[],
) => Promise<
  | { status: "unauthorized" }
  | { status: "ok"; results: { clientId: string; outcome: "saved" | "rejected"; error?: string }[] }
>;

const DB_NAME = "foodwheeler";
const STORE = "outbox";
const FLUSH_EVENT = "foodwheeler:outbox-changed";

let dbPromise: Promise<IDBPDatabase> | null = null;
const getDb = () =>
  (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: "clientId" });
    },
  }));

/** Drop the cached connection (used by tests, and safe to call any time). */
export async function closeOutbox() {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p).close();
}

/**
 * Write (or overwrite - same clientId means the same session, latest wins) a
 * decision into the outbox, then nudge the sync manager. Never touches the
 * network.
 */
export async function enqueueDecision(ownerId: string | null, payload: DecisionPayload): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  const prev = (await tx.store.get(payload.clientId)) as OutboxEntry | undefined;
  const entry: OutboxEntry = {
    clientId: payload.clientId,
    ownerId,
    payload,
    rev: (prev?.rev ?? 0) + 1,
    status: "pending",
    createdAt: prev?.createdAt ?? Date.now(),
  };
  await tx.store.put(entry);
  await tx.done;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLUSH_EVENT));
}

/** Subscribe to "something was enqueued". Returns an unsubscribe function. */
export function onOutboxChanged(cb: () => void) {
  window.addEventListener(FLUSH_EVENT, cb);
  return () => window.removeEventListener(FLUSH_EVENT, cb);
}

/** Entries `userId` is allowed to flush: their own, plus unclaimed guest ones. */
async function flushable(userId: string): Promise<OutboxEntry[]> {
  const all = (await (await getDb()).getAll(STORE)) as OutboxEntry[];
  return all
    .filter((e) => e.status === "pending" && (e.ownerId === userId || e.ownerId === null))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function outboxCounts(userId: string) {
  const all = (await (await getDb()).getAll(STORE)) as OutboxEntry[];
  const mine = all.filter((e) => e.ownerId === userId || e.ownerId === null);
  return {
    pending: mine.filter((e) => e.status === "pending").length,
    failed: mine.filter((e) => e.status === "failed").length,
  };
}

/**
 * Drops every entry `userId` could flush (their own, plus unclaimed guest
 * ones). "Clear history" pairs this with the server delete: without it, a
 * decision still waiting to sync - or one made offline - would flush right
 * back into the account seconds after it was cleared.
 */
export async function clearOutbox(userId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  const all = (await tx.store.getAll()) as OutboxEntry[];
  for (const e of all) {
    if (e.ownerId === userId || e.ownerId === null) await tx.store.delete(e.clientId);
  }
  await tx.done;
}

async function settle(entry: OutboxEntry, outcome: "saved" | "rejected", error?: string) {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  const cur = (await tx.store.get(entry.clientId)) as OutboxEntry | undefined;
  // Edited (or removed) while the push was in flight: leave the newer state alone.
  if (cur && cur.rev === entry.rev) {
    if (outcome === "saved") await tx.store.delete(entry.clientId);
    else await tx.store.put({ ...cur, status: "failed", lastError: error });
  }
  await tx.done;
}

let inFlight: Promise<FlushResult> | null = null;

export type FlushResult = { pushed: number; rejected: number; stopped: null | "unauthorized" | "error" };

/**
 * Push everything `userId` may flush. Stops at the first transport error or
 * an expired session, leaving the remaining entries for the next attempt
 * (nothing is lost or reordered). Concurrent calls in one tab share a single
 * run; across tabs the server-side upsert makes a double push harmless.
 */
export function flushOutbox(userId: string, push: PushFn, batchSize = 20): Promise<FlushResult> {
  return (inFlight ??= run(userId, push, batchSize).finally(() => {
    inFlight = null;
  }));
}

async function run(userId: string, push: PushFn, batchSize: number): Promise<FlushResult> {
  const result: FlushResult = { pushed: 0, rejected: 0, stopped: null };
  for (;;) {
    const batch = (await flushable(userId)).slice(0, batchSize);
    if (batch.length === 0) return result;

    let res: Awaited<ReturnType<PushFn>>;
    try {
      res = await push(batch.map((e) => e.payload));
    } catch {
      return { ...result, stopped: "error" }; // offline / server down: retry later
    }
    if (res.status === "unauthorized") return { ...result, stopped: "unauthorized" };

    // The server answers one verdict per item, in order.
    let progressed = false;
    for (const [i, entry] of batch.entries()) {
      const r = res.results[i];
      if (!r) continue; // no verdict for it: leave it pending
      await settle(entry, r.outcome, r.error);
      progressed = true;
      if (r.outcome === "saved") result.pushed++;
      else result.rejected++;
    }
    if (!progressed) return { ...result, stopped: "error" }; // avoid spinning forever
  }
}
