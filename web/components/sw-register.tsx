"use client";

import { useEffect, useState } from "react";

// Registers the service worker (public/sw.js) in production only: in dev it
// would cache stale chunks and fight hot reload. Ported from Bill-a, then
// extended with an update prompt: the service worker itself (see
// scripts/sw.template.js) no longer calls skipWaiting() on install, so a
// new version sits WAITING instead of silently swapping chunks out from
// under a page that's mid-request. This component surfaces that wait as a
// "New version ready" banner and only applies it once the user asks.
export function SwRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        setRegistration(reg);

        // An update that finished installing while this tab was closed or
        // backgrounded is already sitting in `reg.waiting` by the time we
        // get here.
        if (reg.waiting) setUpdateReady(true);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + an existing controller means this is an UPDATE
            // (the very first install has no controller yet, and needs no
            // prompt - it activates immediately with nothing to interrupt).
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      } catch {
        /* registration failed - nothing actionable to surface for this */
      }
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // Once the new worker actually takes over, reload once so the page
    // runs under it instead of leaving stale JS running against a new SW.
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-100 mx-auto flex w-[min(90vw,26rem)] items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-surface-fg shadow-[0_20px_50px_-15px_rgba(0,0,0,0.5)]"
    >
      <span>New version ready</span>
      <button
        type="button"
        onClick={() => registration?.waiting?.postMessage({ type: "SKIP_WAITING" })}
        className="shrink-0 rounded-full bg-ember px-3 py-1.5 text-xs font-medium text-ink"
      >
        Refresh
      </button>
    </div>
  );
}
