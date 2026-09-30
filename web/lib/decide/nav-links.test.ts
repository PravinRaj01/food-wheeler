import { describe, expect, it } from "vitest";
import { navLinks, placeSearchLink } from "./nav-links";

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

describe("placeSearchLink", () => {
  it("searches for the place by name and address, so a chain lands on the right branch", () => {
    const href = placeSearchLink({ name: "The Chicken Rice Shop", address: "Jalan Dato Onn", lat: 1.4585, lng: 103.7679 });
    expect(href).toBe(
      "https://www.google.com/maps/search/?api=1&query=The%20Chicken%20Rice%20Shop%20Jalan%20Dato%20Onn",
    );
  });

  it("falls back to the coordinates when the address is only a placeholder", () => {
    for (const address of ["Nearby", "nearby", "", "   ", undefined]) {
      expect(placeSearchLink({ name: "KFC", address, lat: 1.43, lng: 103.63 })).toBe(
        "https://www.google.com/maps/search/?api=1&query=KFC%201.43%2C103.63",
      );
    }
  });

  it("is a search, not a route - a route to a bare pin has no opening hours", () => {
    const href = placeSearchLink({ name: "X", lat: 1, lng: 2 });
    expect(href).toContain("/maps/search/");
    expect(href).not.toContain("/dir/");
    expect(href).not.toContain("destination=");
  });

  it("escapes names with awkward characters", () => {
    const href = placeSearchLink({ name: "Ah Seng & Sons #1", address: "Jln 3/4", lat: 1, lng: 2 });
    expect(href).toContain("Ah%20Seng%20%26%20Sons%20%231%20Jln%203%2F4");
    expect(new URL(href).searchParams.get("query")).toBe("Ah Seng & Sons #1 Jln 3/4");
  });
});
