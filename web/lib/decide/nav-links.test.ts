import { describe, expect, it } from "vitest";
import { navLinks } from "./nav-links";

describe("navLinks", () => {
  it("always includes Google Maps, Waze and OpenStreetMap", () => {
    const ids = navLinks(1.42, 103.66, "Test Place", "other").map((o) => o.id);
    expect(ids).toEqual(["google", "waze", "osm"]);
  });

  it("adds Apple Maps on iOS and nothing else platform-specific", () => {
    const ids = navLinks(1.42, 103.66, "Test Place", "ios").map((o) => o.id);
    expect(ids).toEqual(["google", "waze", "apple", "osm"]);
  });

  it("adds an 'Other apps' geo: option on Android", () => {
    const options = navLinks(1.42, 103.66, "Test Place", "android");
    expect(options.map((o) => o.id)).toEqual(["google", "waze", "other", "osm"]);
    const other = options.find((o) => o.id === "other")!;
    expect(other.href).toBe("geo:1.42,103.66?q=1.42,103.66(Test%20Place)");
  });

  it("builds destination-only links with no 'from' coordinate", () => {
    const options = navLinks(1.42, 103.66, "Test Place", "other");
    for (const o of options) {
      expect(o.href).not.toMatch(/from=\d/);
    }
    expect(options.find((o) => o.id === "google")!.href).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1.42,103.66&travelmode=driving",
    );
    expect(options.find((o) => o.id === "waze")!.href).toBe("https://waze.com/ul?ll=1.42,103.66&navigate=yes");
  });
});
