// Generates every app icon from assets/logo-mark.svg (the isolated compass
// +ring+fork glyph, transparent background, viewBox 0 0 256 255).
//
// Each output is built as one composed SVG string (gradient background +
// the mark nested inside, scaled via its own x/y/width/height/viewBox) and
// rasterized once through sharp/librsvg - no lossy PNG-to-PNG resampling.
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markSvg = readFileSync(path.join(root, "assets", "logo-mark.svg"), "utf8");
const markInner = markSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const MARK_VB = "0 0 256 255";

const GRADIENT = `
  <defs>
    <radialGradient id="bg" cx="32%" cy="24%" r="85%">
      <stop offset="0%" stop-color="#C2410C"/>
      <stop offset="60%" stop-color="#9A3412"/>
      <stop offset="100%" stop-color="#431407"/>
    </radialGradient>
  </defs>`;

function composed({ size, markScale, cornerPct = 0 }) {
  const inner = size * markScale;
  const offset = (size - inner) / 2;
  const rx = size * cornerPct;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
${GRADIENT}
<rect width="${size}" height="${size}" rx="${rx}" fill="url(#bg)"/>
<svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" viewBox="${MARK_VB}">${markInner}</svg>
</svg>`;
}

async function render(svg, outPath, size) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(outPath);
  console.log("  wrote", path.relative(root, outPath), `(${size}x${size})`);
}

async function main() {
  const publicDir = path.join(root, "public");
  const appDir = path.join(root, "app");
  mkdirSync(publicDir, { recursive: true });

  // Manifest icons (public/, referenced from app/manifest.ts) - "any" purpose,
  // full app-icon look with rounded corners (Android applies its own mask on
  // top for adaptive icons, but this is what shows for "any").
  await render(composed({ size: 192, markScale: 0.62, cornerPct: 0.22 }), path.join(publicDir, "icon-192.png"), 192);
  await render(composed({ size: 512, markScale: 0.62, cornerPct: 0.22 }), path.join(publicDir, "icon-512.png"), 512);

  // Maskable: full-bleed background (no corner rounding - the OS applies its
  // own mask shape), glyph shrunk further so it survives a circular crop.
  await render(composed({ size: 512, markScale: 0.46, cornerPct: 0 }), path.join(publicDir, "maskable-512.png"), 512);

  // Next.js file-based metadata icons: app/icon.png -> favicon links,
  // app/apple-icon.png -> apple-touch-icon. Rendered fresh at each target
  // size (not downscaled from 512) so small sizes stay crisp.
  await render(composed({ size: 32, markScale: 0.66, cornerPct: 0.22 }), path.join(appDir, "icon.png"), 32);
  await render(composed({ size: 180, markScale: 0.62, cornerPct: 0.22 }), path.join(appDir, "apple-icon.png"), 180);

  // A couple of PWA install-sheet screenshots' worth of headroom isn't
  // needed yet (Phase 1 screenshots come later); icons only for now.
  console.log("Icon build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
