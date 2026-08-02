// One-off generator for iOS icon + splash source assets.
// Renders the same "N" mark as src/app/icon.tsx, but full-bleed square
// (App Store marketing icons must be 1024x1024 with no transparency).
// Usage: node scripts/generate-ios-assets.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const page_html = (fontSize) => `<!doctype html><html><body style="margin:0">
  <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a">
    <div style="color:#ff5b3a;font-family:Georgia,serif;font-size:${fontSize}px;font-weight:700;font-style:italic;line-height:1;letter-spacing:-0.04em">N</div>
  </div></body></html>`;

const targets = [
  { file: 'assets/icon-only.png', size: 1024, fontSize: 680 },
  { file: 'assets/splash.png', size: 2732, fontSize: 560 },
  { file: 'assets/splash-dark.png', size: 2732, fontSize: 560 },
];

mkdirSync('assets', { recursive: true });
const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(page_html(t.fontSize));
  await page.screenshot({ path: t.file });
  await page.close();
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
await browser.close();
