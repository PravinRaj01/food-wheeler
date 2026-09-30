export type NavPlatform = "ios" | "android" | "other";

export interface NavOption {
  id: string;
  label: string;
  href: string;
}

/** Every option is destination-only - each app fills in the starting point
 * from the phone's own current location, so there's no "from" coordinate to
 * get wrong (see the history detail page's old from===to bug). Pure and
 * platform-driven so it's unit-testable without a real browser. */
export function navLinks(lat: number, lng: number, name: string, platform: NavPlatform): NavOption[] {
  const options: NavOption[] = [
    {
      id: "google",
      label: "Google Maps",
      href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    },
    { id: "waze", label: "Waze", href: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` },
  ];
  if (platform === "ios") {
    options.push({ id: "apple", label: "Apple Maps", href: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` });
  }
  if (platform === "android") {
    // Triggers Android's own "open with" app chooser instead of naming one
    // more app ourselves - covers whatever nav apps are actually installed.
    options.push({
      id: "other",
      label: "Other apps…",
      href: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`,
    });
  }
  options.push({
    id: "osm",
    label: "OpenStreetMap",
    href: `https://www.openstreetmap.org/directions?from=&to=${lat}%2C${lng}`,
  });
  return options;
}

/** A Google Maps SEARCH for the place - not a route to its coordinates. The
 * directions links above drop a bare pin, which carries no opening hours; a
 * search lands on the place's own card, which does. Our place data has no
 * hours at all, so this is how a couple can check one is open.
 *
 * The name plus address narrows a chain to the right branch (a name alone
 * can land on a different outlet); when the address is only a placeholder the
 * coordinates stand in for it. */
export function placeSearchLink(place: { name: string; address?: string; lat: number; lng: number }): string {
  const address = place.address?.trim();
  const where = address && address.toLowerCase() !== "nearby" ? address : `${place.lat},${place.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${where}`)}`;
}
