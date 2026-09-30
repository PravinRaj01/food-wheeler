"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as q from "@/lib/db/queries";
import { getUserIdOrNull } from "@/lib/auth/session";
import { historyMatchSchema, historyQuerySchema, type HistoryRow } from "@/lib/history/filters";

// Server actions are reachable by any direct POST, not just the History UI,
// so every one re-checks the session and re-validates its own input. The
// user always comes from the session, never from an argument - and every
// query it calls is scoped to that user_id, so an id belonging to somebody
// else simply matches nothing.

export type ActionResult = { status: "unauthorized" } | { status: "ok"; changed: boolean };
export type DeleteManyResult = { status: "unauthorized" } | { status: "ok"; deleted: number };
export type MoreResult =
  | { status: "unauthorized" }
  | { status: "ok"; rows: HistoryRow[]; nextCursor: string | null };

const idSchema = z.uuid();

export async function loadMoreDecisions(input: unknown): Promise<MoreResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };
  const query = historyQuerySchema.parse(input);
  const page = await q.listDecisionsForUser(getDb(), userId, {
    q: query.q,
    cuisine: query.cuisine,
    via: query.via,
    favouritesOnly: query.favouritesOnly,
    excludeFavourites: query.excludeFavourites,
    cursor: query.cursor,
  });
  return { status: "ok", ...page };
}

export async function deleteDecision(id: string): Promise<ActionResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };
  const changed = await q.deleteDecisionForUser(getDb(), userId, idSchema.parse(id));
  revalidatePath("/history");
  return { status: "ok", changed };
}

export async function toggleFavourite(id: string, favourite: boolean): Promise<ActionResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };
  const changed = await q.setFavourite(getDb(), userId, idSchema.parse(id), z.boolean().parse(favourite));
  revalidatePath("/history");
  return { status: "ok", changed };
}

/** Delete the ticked rows. Capped so one POST can't ask for an absurd list;
 * "everything" goes through deleteMatching instead. */
export async function deleteDecisions(ids: unknown): Promise<DeleteManyResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };
  const parsed = z.array(idSchema).min(1).max(500).parse(ids);
  const deleted = await q.deleteDecisionsForUser(getDb(), userId, parsed);
  revalidatePath("/history");
  return { status: "ok", deleted };
}

/** Delete everything matching the view's filters - "select all N", including
 * rows the page never loaded. No filters at all is clear-history. */
export async function deleteMatching(input: unknown): Promise<DeleteManyResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };
  const match = historyMatchSchema.parse(input);
  const deleted = await q.deleteMatchingForUser(getDb(), userId, match);
  revalidatePath("/history");
  return { status: "ok", deleted };
}
