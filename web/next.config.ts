import type { NextConfig } from "next";

// Content-Security-Policy.
//
// Adapted from the Bill-a project's CSP, with the amendments this app
// actually needs:
//  - Permissions-Policy ALLOWS geolocation and microphone for our own
//    origin (Bill-a blocks both outright - this app's whole point needs them).
//  - connect-src adds the Flask/Cloud Run API origin (the browser calls it
//    directly - see lib/api.ts) alongside 'self' (server actions, /api/auth).
//  - img-src adds OSM's tile domains (the map) and Google's profile-picture
//    host (an OAuth user's avatar).
// Each other allowance and why:
//  - script-src 'unsafe-inline'  Next's inline bootstrap script; removing it
//                                means nonces, which force every page to
//                                render dynamically.
//  - worker-src 'self'           the service worker registration (public/sw.js).
//  - form-action accounts.google.com
//                                "Continue with Google" is a POST that 302s there.
//  - dev only: 'unsafe-eval' and websockets for Turbopack's hot reload.
const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : "";
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Native module (prebuilt per platform): keep it out of the server bundle
  // so the correct platform binary gets loaded rather than bundled wrong.
  serverExternalPackages: ["@node-rs/argon2"],
  async headers() {
    return [
      // The service worker must always be revalidated, or a bad version could stick.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
