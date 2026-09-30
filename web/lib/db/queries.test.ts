import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, escapeLike, toHistoryRow } from "./queries";

describe("escapeLike", () => {
  it("makes LIKE's own wildcards literal", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("nasi lemak")).toBe("nasi lemak");
  });
});

describe("keyset cursor", () => {
  it("round-trips a row's position", () => {
    const row = { createdAt: new Date("2026-09-30T04:15:00.123Z"), id: "0b0f7b9a-2f7a-4d0e-9d3e-0a3c9a2c5e11" };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });

  it("treats garbage as no cursor rather than throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(Buffer.from("nope|id").toString("base64url"))).toBeNull();
  });
});

describe("toHistoryRow", () => {
  it("keeps only what the UI renders, with the date as a string", () => {
    const row = toHistoryRow({
      id: "id-1",
      userId: "u",
      clientId: "c",
      partner1Text: "secret",
      partner2Text: "secret",
      engine: "laya",
      confidence: 0.2,
      reason: "picked",
      rank: 2,
      shortlistSize: 8,
      favourite: true,
      radiusKm: 5,
      source: "overture",
      winner: { id: "w" } as never,
      runnerUps: [],
      tiebreakers: [],
      createdAt: new Date("2026-09-30T00:00:00.000Z"),
    });
    expect(row).toEqual({
      id: "id-1",
      createdAt: "2026-09-30T00:00:00.000Z",
      winner: { id: "w" },
      reason: "picked",
      rank: 2,
      shortlistSize: 8,
      favourite: true,
    });
    expect(row).not.toHaveProperty("partner1Text");
  });
});
