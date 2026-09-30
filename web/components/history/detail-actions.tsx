"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { deleteDecision, toggleFavourite } from "@/lib/actions/history";
import { cn } from "@/lib/utils";
import { ConfirmDrawer } from "@/components/history/confirm-drawer";

/** Favourite and delete for one saved decision, on its detail page. */
export function DetailActions({ id, name, favourite: initial }: { id: string; name: string; favourite: boolean }) {
  const router = useRouter();
  const [favourite, setFavourite] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    const next = !favourite;
    setFavourite(next); // optimistic - reverted below if the server says no
    setError(null);
    try {
      const res = await toggleFavourite(id, next);
      if (res.status !== "ok" || !res.changed) throw new Error("not saved");
    } catch {
      setFavourite(!next);
      setError("Couldn't update that favourite - try again.");
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteDecision(id);
      if (res.status !== "ok") throw new Error("not deleted");
      router.push("/history");
    } catch {
      setBusy(false);
      setConfirming(false);
      setError("That didn't go through - try again.");
    }
  }

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={favourite}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
        >
          <Star className={cn("h-4 w-4", favourite && "fill-ember text-ember")} />
          {favourite ? "Favourite" : "Add to favourites"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-cream/60">
          {error}
        </p>
      )}
      <ConfirmDrawer
        open={confirming}
        onOpenChange={(open) => !open && !busy && setConfirming(false)}
        title="Delete this decision?"
        description={`${name} is removed from your history. This can't be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={onDelete}
      />
    </div>
  );
}
