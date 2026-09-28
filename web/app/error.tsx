"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/logo";

/** Catches a render error anywhere under the root layout except inside
 * (app) - that group has its own error.tsx with an AppShell-aware "back to
 * Decide" link instead of this generic reset. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center text-cream">
      <Logo className="h-12 w-12 opacity-80" />
      <div>
        <h1 className="font-display text-xl font-semibold">Something went sideways</h1>
        <p className="mt-1 text-sm text-cream/60">Your third wheel tripped. Give it another go.</p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="flex items-center gap-2 rounded-xl bg-ember px-6 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        <RotateCcw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
