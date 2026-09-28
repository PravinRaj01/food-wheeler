"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Drawer } from "vaul";
import { Share, SquarePlus, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// display-mode can genuinely change while the page is open (right after the
// user installs), so this is a real subscription, not just a one-time read.
function subscribeStandalone(callback: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getStandaloneSnapshot() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function getStandaloneServerSnapshot() {
  return false;
}

// userAgent never changes mid-session, so this has nothing to subscribe to -
// but useSyncExternalStore is still the right primitive for "a browser-only
// value the server can't know", handling the hydration hand-off for us.
function subscribeNoop() {
  return () => {};
}
function getIOSSnapshot() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
}
function getIOSServerSnapshot() {
  return false;
}

export function InstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const isStandalone = useSyncExternalStore(subscribeStandalone, getStandaloneSnapshot, getStandaloneServerSnapshot);
  const isIOS = useSyncExternalStore(subscribeNoop, getIOSSnapshot, getIOSServerSnapshot);
  const [iosDrawerOpen, setIosDrawerOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (isStandalone) return null;
  if (!deferred && !isIOS) return null; // no install path we can offer

  async function handleClick() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    setIosDrawerOpen(true);
  }

  return (
    <>
      <button
        onClick={handleClick}
        className={
          className ??
          "hairline-b rounded-full border border-line px-5 py-2 text-sm font-medium text-cream transition-colors hover:bg-glass"
        }
      >
        Install app
      </button>

      <Drawer.Root open={iosDrawerOpen} onOpenChange={setIosDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-surface p-6 text-surface-fg outline-none">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mx-auto flex max-w-sm flex-col gap-4">
              <div className="flex items-center justify-between">
                <Drawer.Title className="font-display text-lg font-semibold">Add to Home Screen</Drawer.Title>
                <Drawer.Close className="text-surface-fg/60">
                  <X className="h-5 w-5" />
                </Drawer.Close>
              </div>
              <p className="flex items-center gap-2 text-sm text-surface-fg/80">
                <Share className="h-4 w-4 shrink-0" /> Tap the Share icon in Safari&apos;s toolbar
              </p>
              <p className="flex items-center gap-2 text-sm text-surface-fg/80">
                <SquarePlus className="h-4 w-4 shrink-0" /> Then choose &quot;Add to Home Screen&quot;
              </p>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
