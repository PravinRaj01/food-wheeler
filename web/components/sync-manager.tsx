"use client";

import { useEffect } from "react";
import { pushOutbox } from "@/lib/actions/sync";
import { flushOutbox, onOutboxChanged } from "@/lib/sync/outbox";

const IDLE_MS = 1500; // batch quick successive saves into one push
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

/**
 * Renders nothing. Drains the IndexedDB outbox to the server for the
 * signed-in user: on load (which is also how guest entries get claimed
 * right after a login), shortly after each save, when the browser comes
 * back online, and when the tab is backgrounded. Failures retry with
 * exponential backoff. Ported from the Bill-a project's sync manager.
 *
 * Guests have no session, so nothing is pushed for them - their saves just
 * wait in IndexedDB until they log in.
 */
export function SyncManager({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (!userId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      // Web Locks stops several open tabs from all pushing at once; without
      // support we just proceed (the server upsert makes a double push harmless).
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const flush = () => flushOutbox(userId, pushOutbox);
      const res = locks
        ? await locks.request("foodwheeler-outbox-flush", { ifAvailable: true }, (lock) => (lock ? flush() : null))
        : await flush();
      if (!res || disposed) return;

      if (res.stopped === "error") {
        failures++;
        schedule(Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
      } else {
        failures = 0; // "unauthorized" is not retried: the next page load re-checks the session
      }
    };

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    };

    const onOnline = () => {
      failures = 0;
      schedule(0);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") schedule(0);
    };

    schedule(0);
    const off = onOutboxChanged(() => schedule(IDLE_MS));
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      disposed = true;
      clearTimeout(timer);
      off();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [userId]);

  return null;
}
