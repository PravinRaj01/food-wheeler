"use client";

import { Drawer } from "vaul";
import { X } from "lucide-react";

/** A destructive-action confirmation in the same bottom-sheet style as the
 * app's other drawers (location-prompt.tsx, directions-sheet.tsx) - deleting
 * a decision can't be undone, so it always asks first. */
export function ConfirmDrawer({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-surface p-6 text-surface-fg outline-none">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mx-auto flex max-w-sm flex-col gap-4">
            <div className="flex items-center justify-between">
              <Drawer.Title className="font-display text-lg font-semibold">{title}</Drawer.Title>
              <Drawer.Close className="text-surface-fg/60" aria-label="Close">
                <X className="h-5 w-5" />
              </Drawer.Close>
            </div>
            <Drawer.Description className="text-sm text-surface-fg/80">{description}</Drawer.Description>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl border border-line py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="rounded-xl bg-ember py-3 text-sm font-medium text-ink disabled:opacity-50"
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
