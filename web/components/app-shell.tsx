"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, History, LogIn, LogOut, Settings2, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { signOutAction } from "@/app/auth/actions";

export function AppShell({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  const pathname = usePathname();

  // History requires a login (see lib/auth.config.ts), so guests don't get
  // a link that would just bounce them to /login - they get a Login link
  // in its place instead.
  const navItems = [
    { name: "Decide", href: "/decide", icon: UtensilsCrossed },
    { name: "Explore", href: "/explore", icon: Compass },
    ...(signedIn ? [{ name: "History", href: "/history", icon: History }] : []),
    { name: "Settings", href: "/settings", icon: Settings2 },
  ];

  const handleLogout = () => {
    // Wipe the offline copies of the app pages before signing out, so
    // nothing tied to this session is left behind on a shared phone.
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
    return signOutAction();
  };

  return (
    <div className="flex min-h-dvh flex-col text-cream">
      {/* Sticky header */}
      <header className="safe-top hairline-b sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between bg-[var(--orange-2)]/70 px-5 backdrop-blur-md">
        <Link href="/decide" className="flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span className="font-display text-base font-semibold tracking-tight">Food Wheeler</span>
        </Link>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hairline hidden w-60 shrink-0 flex-col px-4 py-6 md:flex">
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "nav-dot flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    active ? "bg-cream text-ink font-semibold" : "text-cream/60 hover:text-cream",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
          {signedIn ? (
            <button onClick={handleLogout} className="mt-auto flex items-center gap-3 px-3 py-2 text-sm text-cream/50 hover:text-cream">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          ) : (
            <Link href="/login" className="mt-auto flex items-center gap-3 px-3 py-2 text-sm text-cream/50 hover:text-cream">
              <LogIn className="h-4 w-4" /> Log in
            </Link>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="hairline-b safe-bottom fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t bg-[var(--orange-3)]/85 px-2 py-2 backdrop-blur-lg md:hidden">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex min-h-11 flex-col items-center gap-1 rounded-lg px-3 py-1.5 transition-all",
                active ? "text-cream scale-105" : "text-cream/50",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium tracking-wide">{item.name}</span>
            </Link>
          );
        })}
        {signedIn ? (
          <button onClick={handleLogout} className="flex min-h-11 flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-cream/50">
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Logout</span>
          </button>
        ) : (
          <Link href="/login" className="flex min-h-11 flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-cream/50">
            <LogIn className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Log in</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
