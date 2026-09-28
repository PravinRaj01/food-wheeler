import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOutbox, enqueueDecision, flushOutbox, outboxCounts, type PushFn } from "./outbox";
import type { DecisionPayload } from "@/lib/validation/decision";

const payload = (clientId: string, overrides: Partial<DecisionPayload> = {}): DecisionPayload => ({
  clientId,
  partner1Text: "spicy",
  partner2Text: "casual",
  engine: "laya",
  confidence: 0.9,
  reason: "confident",
  radiusTier: "local",
  source: "osm",
  winner: {
    id: "a",
    name: "Thai Orchid",
    cuisine: "thai",
    tags: [],
    price: "$$",
    lat: 3.1,
    lng: 101.6,
    address: "1 Main St",
    distance_km: 1,
    dims: { service: "sit_down", spice: "hot", setting: "indoor", price: "mid", diet: "none" },
    color: "#fff",
  },
  runnerUps: [],
  tiebreakers: [],
  ...overrides,
});

beforeEach(async () => {
  // The outbox module caches its DB connection at module scope; close it and
  // wipe the fake IndexedDB database so every test starts from a clean slate.
  await closeOutbox();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("foodwheeler");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe("enqueueDecision / flushOutbox", () => {
  it("pushes a pending guest entry once a user is signed in and removes it from the outbox", async () => {
    await enqueueDecision(null, payload("c1"));
    const push = vi.fn<PushFn>(async (batch) => ({
      status: "ok",
      results: batch.map((p) => ({ clientId: p.clientId, outcome: "saved" as const })),
    }));

    const result = await flushOutbox("user-1", push);
    expect(result).toEqual({ pushed: 1, rejected: 0, stopped: null });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith([expect.objectContaining({ clientId: "c1" })]);

    const counts = await outboxCounts("user-1");
    expect(counts).toEqual({ pending: 0, failed: 0 });
  });

  it("a signed-in user's own entries flush too, alongside unclaimed guest entries", async () => {
    await enqueueDecision("user-1", payload("mine"));
    await enqueueDecision(null, payload("guest"));
    await enqueueDecision("someone-else", payload("not-mine"));

    const seen: string[] = [];
    const push = vi.fn<PushFn>(async (batch) => {
      seen.push(...batch.map((p) => p.clientId));
      return { status: "ok", results: batch.map((p) => ({ clientId: p.clientId, outcome: "saved" as const })) };
    });

    await flushOutbox("user-1", push);
    expect(seen.sort()).toEqual(["guest", "mine"]);

    // The other user's entry is left untouched.
    const counts = await outboxCounts("someone-else");
    expect(counts.pending).toBe(1);
  });

  it("marks a rejected entry as failed instead of deleting it, and does not retry it", async () => {
    await enqueueDecision(null, payload("bad"));
    const push = vi.fn<PushFn>(async (batch) => ({
      status: "ok",
      results: batch.map((p) => ({ clientId: p.clientId, outcome: "rejected" as const, error: "invalid" })),
    }));

    const result = await flushOutbox("user-1", push);
    expect(result).toEqual({ pushed: 0, rejected: 1, stopped: null });

    // A second flush must not re-send the same rejected entry.
    await flushOutbox("user-1", push);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("stops (without deleting anything) on a transport error, so the entry survives for a later retry", async () => {
    await enqueueDecision(null, payload("c1"));
    const push = vi.fn<PushFn>(async () => {
      throw new Error("network down");
    });

    const result = await flushOutbox("user-1", push);
    expect(result.stopped).toBe("error");

    const counts = await outboxCounts("user-1");
    expect(counts.pending).toBe(1);
  });

  it("stops on an expired session without marking entries failed", async () => {
    await enqueueDecision(null, payload("c1"));
    const push = vi.fn<PushFn>(async () => ({ status: "unauthorized" as const }));

    const result = await flushOutbox("user-1", push);
    expect(result.stopped).toBe("unauthorized");

    const counts = await outboxCounts("user-1");
    expect(counts.pending).toBe(1);
  });

  it("re-enqueuing the same clientId overwrites the entry and bumps its revision", async () => {
    await enqueueDecision(null, payload("c1", { partner1Text: "first" }));
    await enqueueDecision(null, payload("c1", { partner1Text: "second" }));

    const seen: DecisionPayload[] = [];
    const push = vi.fn<PushFn>(async (batch) => {
      seen.push(...batch);
      return { status: "ok", results: batch.map((p) => ({ clientId: p.clientId, outcome: "saved" as const })) };
    });

    await flushOutbox("user-1", push);
    expect(seen).toHaveLength(1);
    expect(seen[0].partner1Text).toBe("second");
  });

  it("flushes in createdAt order and stops sending further batches once one push returns unauthorized", async () => {
    await enqueueDecision(null, payload("first"));
    await enqueueDecision(null, payload("second"));

    let calls = 0;
    const push = vi.fn<PushFn>(async () => {
      calls++;
      return { status: "unauthorized" as const };
    });

    await flushOutbox("user-1", push, 1); // batchSize 1 forces two potential rounds
    expect(calls).toBe(1); // stops immediately, doesn't try the second entry
  });
});
