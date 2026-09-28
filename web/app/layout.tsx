import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { SplashScreen } from "@/components/splash-screen";

// Clash Display (the plan's original pick) is Fontshare-only and would need
// self-hosted font files; Bricolage Grotesque is the closest Google-hosted
// equivalent - same bold, slightly quirky display character, zero
// self-hosting/CDN risk (this session already hit three "free CDN changed
// its rules" surprises, so Next's built-in Google Fonts self-hosting wins).
const displayFont = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
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
