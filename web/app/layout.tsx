import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { SplashScreen } from "@/components/splash-screen";

// An elegant serif for headlines (Fraunces), Inter for everything else -
// the classiness pass's typography decision. Google-hosted, so this keeps
// the same zero self-hosting/CDN-risk property Bricolage Grotesque had.
const displayFont = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});
const bodyFont = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Food Wheeler",
  description: "Two partners, one phone, one decision.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Food Wheeler",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCF4E2" },
    { media: "(prefers-color-scheme: dark)", color: "#2E1006" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// Sets data-theme on <html> from localStorage before first paint - without
// this, a saved Light/Dark preference would flash the OTHER theme for one
// frame while React hydrates and lib/theme.ts's own applyTheme() gets a
// chance to run. Has to be this small inline string, not an import: it
// must execute synchronously, before any stylesheet-dependent paint, which
// rules out anything that waits on module loading. Kept in exact lockstep
// with lib/theme.ts's applyTheme() by hand - there's no way to share the
// literal source between a script tag and a module. The CSP's
// script-src already allows inline scripts (see next.config.ts), so this
// needs no nonce.
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("fw_theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <SplashScreen />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
