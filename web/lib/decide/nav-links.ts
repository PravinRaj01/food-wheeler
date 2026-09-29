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
