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
  themeColor: "#9A3412",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} h-full`}>
      <body className="min-h-dvh antialiased">
        <SplashScreen />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
