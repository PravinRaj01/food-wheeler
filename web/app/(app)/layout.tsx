import { AppShell } from "@/components/app-shell";
import { SyncManager } from "@/components/sync-manager";
import { LocationProvider } from "@/lib/location/location-provider";
import { auth } from "@/lib/auth";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  // Resolved on the server from the signed session cookie (JWT session, no
  // DB query), so guests never see the History nav item light up as if it
  // were usable, and the sync manager only ever runs for a real user.
  const userId = (await auth())?.user?.id ?? null;
  return (
    // Mounted once here (not per-page) so location survives navigating
    // between Decide and Explore, instead of each page holding its own
    // now-you-see-it-now-you-don't geolocation state.
    <LocationProvider>
      <AppShell signedIn={!!userId}>
        <SyncManager userId={userId} />
        {children}
      </AppShell>
    </LocationProvider>
  );
}
