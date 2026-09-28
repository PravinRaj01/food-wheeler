"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The manifest's start_url ("/decide?source=pwa") handles Android/desktop
// installs, but iOS Safari's "Add to Home Screen" can instead reopen
// whatever URL was on screen when it was added - often "/". This catches
// that case: if we're running standalone and landed on the marketing page
// anyway, skip straight to Decide.
export function StandaloneRedirect() {
  const router = useRouter();

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) router.replace("/decide");
  }, [router]);

  return null;
}
