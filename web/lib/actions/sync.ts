"use server";

import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as q from "@/lib/db/queries";
import { getUserIdOrNull } from "@/lib/auth/session";
import { decisionSchema } from "@/lib/validation/decision";

export type PushResult =
  | { status: "unauthorized" }
  | { status: "ok"; results: { clientId: string; outcome: "saved" | "rejected"; error?: string }[] };

const MAX_BATCH = 25;

/**
 * Drains client outbox entries into the caller's own history. The user comes
 * from the session, never from the payload, and upsertDecision is keyed on
 * (user_id, client_id) - so a retry, or a malicious client_id that collides
 * with someone else's, can only ever touch the caller's own row.
 *
 * Items are validated one by one and reported one by one: a permanently bad
 * entry must not block the good ones behind it, and the client needs to know
 * "rejected, don't retry" apart from "couldn't reach the server, retry".
 */
export async function pushOutbox(batch: unknown[]): Promise<PushResult> {
  const userId = await getUserIdOrNull();
  if (!userId) return { status: "unauthorized" };

  const items = z.array(z.unknown()).max(MAX_BATCH).parse(batch);
  const db = getDb();
  const results: { clientId: string; outcome: "saved" | "rejected"; error?: string }[] = [];

  for (const raw of items) {
    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) {
      const clientId = (raw as { clientId?: unknown } | null)?.clientId;
      results.push({
        clientId: typeof clientId === "string" ? clientId : "",
        outcome: "rejected",
        error: parsed.error.issues[0]?.message ?? "invalid",
      });
      continue;
    }
    await q.upsertDecision(db, userId, parsed.data);
    results.push({ clientId: parsed.data.clientId, outcome: "saved" });
  }
  return { status: "ok", results };
}
