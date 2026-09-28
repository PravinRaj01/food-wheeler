"use client";

import { Drawer } from "vaul";
import { MapPin, Settings, X } from "lucide-react";
import type { LocationStatus } from "@/lib/location/location-provider";

/** Shown when "Find Our Table" is tapped with location off - a deliberate
 * moment to ask, not an unprompted browser permission dialog. There is no
 * demo-places fallback any more: enabling location is the only way through,
 * since the backend now refuses a request with no real location outright
 * (see LocationRequired in candidates.py). Follows the same vaul drawer
 * pattern as components/install-prompt.tsx. */
export function LocationPrompt({
  open,
  status,
  onOpenChange,
  onEnable,
}: {
  open: boolean;
  status: LocationStatus;
  onOpenChange: (open: boolean) => void;
  onEnable: () => void;
}) {
  const isBlocked = status === "blocked";

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-surface p-6 text-surface-fg outline-none">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mx-auto flex max-w-sm flex-col gap-4">
            <div className="flex items-center justify-between">
              <Drawer.Title className="font-display text-lg font-semibold">
                {isBlocked ? "Location is blocked" : "Turn on location?"}
              </Drawer.Title>
              <Drawer.Close className="text-surface-fg/60">
                <X className="h-5 w-5" />
              </Drawer.Close>
            </div>

            {isBlocked ? (
              <p className="flex items-start gap-2 text-sm text-surface-fg/80">
                <Settings className="mt-0.5 h-4 w-4 shrink-0" />
                Your browser has blocked location for this site. Open its site
                settings and allow location, then try again - your third
                wheel needs to know where you are to find anywhere real.
              </p>
            ) : (
              <>
                <p className="flex items-start gap-2 text-sm text-surface-fg/80">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  Your third wheel needs to know where you are to find real
                  places nearby. Your position stays on this device and is
                  only sent with your requests.
                </p>
                <button
                  type="button"
                  onClick={onEnable}
                  className="w-full rounded-xl bg-ember py-3 text-sm font-medium text-ink"
                >
                  Enable location
                </button>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
