import { describe, expect, it } from "vitest";
import { formatDistance } from "./distance";

describe("formatDistance", () => {
  it("shows the real driving distance and time when both are known", () => {
    expect(formatDistance({ distance_km: 3.1, route_km: 8.4, route_min: 14 })).toBe("8.4 km drive · 14 min");
  });

  it("falls back to the straight-line distance when there's no route", () => {
    expect(formatDistance({ distance_km: 6.1 })).toBe("~6.1 km straight line");
  });

  it("falls back to straight-line if only one of route_km/route_min is present", () => {
    expect(formatDistance({ distance_km: 6.1, route_km: 8.4 })).toBe("~6.1 km straight line");
    expect(formatDistance({ distance_km: 6.1, route_min: 14 })).toBe("~6.1 km straight line");
  });
});
