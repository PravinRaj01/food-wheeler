"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/logo";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-5 py-24 text-center">
      <Logo className="h-12 w-12 opacity-80" />
      <div>
        <h1 className="font-display text-xl font-semibold text-cream">Something went sideways</h1>
        <p className="mt-1 text-sm text-cream/60">Your third wheel tripped. Give it another go.</p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-2 rounded-xl bg-ember px-5 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/decide"
          className="flex items-center gap-2 rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-glass"
        >
          Back to Decide
        </Link>
      </div>
    </div>
  );
}
