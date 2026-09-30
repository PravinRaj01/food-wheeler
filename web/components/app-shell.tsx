"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, History, Settings2, UtensilsCrossed, WifiOff } from "lucide-react";
import { Logo } from "@/components/logo";
import { Dock } from "@/components/dock";
import { useOnline } from "@/lib/hooks/use-online";
import { signOutAction } from "@/app/auth/actions";

export function AppShell({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  const pathname = usePathname();
  const isOnline = useOnline();

  // History requires a login (see lib/auth.config.ts), so guests don't get
  // a link that would just bounce them to /login - they get a Login link
  // in its place instead (see Dock's own account key).
  const primaryItems = [
    { name: "Decide", href: "/decide", icon: UtensilsCrossed },
    { name: "Explore", href: "/explore", icon: Compass },
    ...(signedIn ? [{ name: "History", href: "/history", icon: History }] : []),
  ];
  const secondaryItems = [{ name: "Settings", href: "/settings", icon: Settings2 }];

  const handleLogout = () => {
    // Wipe the offline copies of the app pages before signing out, so
    // nothing tied to this session is left behind on a shared phone.
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
    return signOutAction();
  };

  return (
    <div className="flex min-h-dvh flex-col text-cream">
      {/* Sticky header - a blurred canvas-toned bar (not surface: a surface
          tone here turned into a bright bar sitting on top of the dark
          canvas in dark mode, which read as broken chrome rather than a
          deliberate lift-off-the-page moment). */}
      <header className="safe-top hairline-b sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between bg-canvas/75 px-5 text-canvas-fg backdrop-blur-md">
        <Link href="/decide" className="flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span className="font-display text-base font-semibold tracking-tight">Food Wheeler</span>
        </Link>
      </header>

      {!isOnline && (
        <div role="status" className="flex items-center justify-center gap-1.5 bg-black/30 py-1.5 text-xs text-cream/70">
          <WifiOff className="h-3.5 w-3.5" /> You&apos;re offline — showing what&apos;s cached
        </div>
      )}

      {/* Main content - bottom padding on every breakpoint now that the
          dock floats over the page at every screen size (there's no
          desktop sidebar taking that space instead any more). */}
      {/* overflow-clip, not overflow-auto: main never scrolls (the page does),
          but auto still made it the scroll container for everything inside,
          so a `sticky` element in a page (History's select bar) had nothing
          to stick to. Clip keeps the same clipping without that. */}
      <main className="flex-1 overflow-clip pb-28">{children}</main>

      <Dock
        primaryItems={primaryItems}
        secondaryItems={secondaryItems}
        pathname={pathname}
        signedIn={signedIn}
        onLogout={handleLogout}
      />
    </div>
  );
}
