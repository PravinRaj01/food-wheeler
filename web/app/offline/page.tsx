import Link from "next/link";
import { Logo } from "@/components/logo";

// Served by the service worker (scripts/sw.template.js) when a navigation
// hits neither the network nor a cached copy of the page. Deliberately a
// plain Server Component with no client interactivity - it needs to render
// correctly from a precached response with no guarantee hydration succeeds.
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center text-cream">
      <Logo className="h-12 w-12 opacity-80" />
      <div>
        <h1 className="font-display text-xl font-semibold">You&apos;re offline</h1>
        <p className="mt-1 text-sm text-cream/60">Your third wheel needs a connection. Reconnect and try again.</p>
      </div>
      <Link
        href="/decide"
        className="rounded-xl bg-ember px-6 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        Try again
      </Link>
    </div>
  );
}
