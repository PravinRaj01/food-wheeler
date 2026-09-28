import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { decisions, preferences } from "./schema";
import type { DecisionPayload } from "@/lib/validation/decision";

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
    radiusTier: input.radiusTier,
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
        radiusTier: values.radiusTier,
        source: values.source,
        winner: values.winner,
        runnerUps: values.runnerUps,
        tiebreakers: values.tiebreakers,
      },
    })
    .returning({ id: decisions.id });
  return row;
}

export async function listDecisionsForUser(db: Db, userId: string, limit = 100) {
  return db
    .select()
    .from(decisions)
    .where(eq(decisions.userId, userId))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);
}

export async function getDecisionForUser(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.userId, userId), eq(decisions.id, id)))
    .limit(1);
  return row ?? null;
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
