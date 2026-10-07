// Generates the PWA icons in public/icons/ from inline SVG (the CampusLink graduation cap, Lucide line style).
// Uses the Playwright Chromium installed for the test suite: run `npm install` in ../tests first, then
//   node scripts/generate-icons.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "icons");
const require = createRequire(path.join(here, "..", "..", "tests", "package.json"));
const { chromium } = require("@playwright/test");

const INDIGO = "#253C6D";
const CORAL = "#F2842F";

// Lucide "graduation-cap" paths (24x24 viewBox, stroke icon).
const CAP = `
  <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>
  <path d="M22 10v6"/>
  <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>`;

/** size: px; glyph: share of the canvas used by the cap; rounded: transparent rounded corners. */
function iconSvg({ size, glyph, rounded, background = INDIGO, color = "#FFFFFF", accent = true }) {
  const radius = rounded ? size * 0.22 : 0;
  const g = size * glyph;
  const offset = (size - g) / 2;
  const scale = g / 24;
  const dot = accent ? `<circle cx="${size * 0.74}" cy="${size * 0.27}" r="${size * 0.06}" fill="${CORAL}"/>` : "";
  const bg = background ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAP}</g>
  ${dot}
</svg>`;
}

const icons = [
  { file: "icon-192.png", size: 192, svg: iconSvg({ size: 192, glyph: 0.62, rounded: true }) },
  { file: "icon-512.png", size: 512, svg: iconSvg({ size: 512, glyph: 0.62, rounded: true }) },
  // Maskable: full-bleed background, artwork inside the 80% safe zone.
  { file: "maskable-512.png", size: 512, svg: iconSvg({ size: 512, glyph: 0.5, rounded: false }) },
  // iOS rounds the corners itself and ignores transparency.
  { file: "apple-touch-icon.png", size: 180, svg: iconSvg({ size: 180, glyph: 0.6, rounded: false }) },
  // Android notification badge: white glyph on transparent background (alpha mask).
  { file: "badge-96.png", size: 96, svg: iconSvg({ size: 96, glyph: 0.8, rounded: false, background: null, accent: false }) },
];

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "icon.svg"), iconSvg({ size: 512, glyph: 0.62, rounded: true }));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { file, size, svg } of icons) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(outDir, file), omitBackground: true });
    console.log(`public/icons/${file}`);
  }
} finally {
  await browser.close();
}
