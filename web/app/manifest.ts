import type { MetadataRoute } from "next";

// Next's file-based manifest convention: auto-served at /manifest.webmanifest
// with the <link rel="manifest"> tag injected automatically - no need to
// reference it manually from layout.tsx metadata.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Food Wheeler",
    short_name: "Food Wheeler",
    description: "Two partners, one phone, one decision.",
    start_url: "/decide?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FCF4E2",
    theme_color: "#FCF4E2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Decide", url: "/decide", description: "Start a new decision" },
      { name: "History", url: "/history", description: "Past decisions" },
    ],
  };
}
