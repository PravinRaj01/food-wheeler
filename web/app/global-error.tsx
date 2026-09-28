"use client";

import { useEffect } from "react";

// Catches an error in the root layout itself - this REPLACES the entire
// document, so it can't assume globals.css or any other app chrome
// rendered successfully. Inline styles only, deliberately, as a last resort
// that doesn't depend on anything else having worked.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          padding: 24,
          textAlign: "center",
          background: "#FCF4E2",
          color: "#431407",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Food Wheeler hit a snag</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>Reload to try again.</p>
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "#EA580C",
            color: "#1C0A03",
            border: "none",
            borderRadius: 12,
            padding: "12px 24px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
