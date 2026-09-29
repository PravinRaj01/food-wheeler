"use client";

import { Drawer } from "vaul";
import { X } from "lucide-react";
import { usePlatform } from "@/lib/hooks/use-platform";
import { navLinks } from "@/lib/decide/nav-links";
import { local } from "@/lib/safe-storage";

const LAST_NAV_APP_KEY = "fw_nav_app";

/** "Open in…" - lets a couple pick their own navigation app instead of
 * being forced into OpenStreetMap. Every link is destination-only (see
 * nav-links.ts), so there's no "from" coordinate to get wrong. Follows the
 * same vaul drawer pattern as location-prompt.tsx. */
export function DirectionsSheet({
  open,
  onOpenChange,
  lat,
  lng,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lat: number;
  lng: number;
  name: string;
}) {
  const platform = usePlatform();
  const options = navLinks(lat, lng, name, platform);
  const lastUsed = local.get(LAST_NAV_APP_KEY, "");
  const ordered = lastUsed
    ? [...options.filter((o) => o.id === lastUsed), ...options.filter((o) => o.id !== lastUsed)]
    : options;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-surface p-6 text-surface-fg outline-none">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mx-auto flex max-w-sm flex-col gap-4">
            <div className="flex items-center justify-between">
              <Drawer.Title className="font-display text-lg font-semibold">Open in…</Drawer.Title>
              <Drawer.Close className="text-surface-fg/60">
                <X className="h-5 w-5" />
              </Drawer.Close>
            </div>
            <div className="flex flex-col gap-2">
              {ordered.map((opt) => (
                <a
                  key={opt.id}
                  href={opt.href}
                  target="_blank"
                  rel="noopener"
                  onClick={() => local.set(LAST_NAV_APP_KEY, opt.id)}
                  className="rounded-xl border border-line px-4 py-3 text-center text-sm font-medium text-surface-fg transition-colors hover:bg-glass"
                >
                  {opt.label}
                </a>
              ))}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
