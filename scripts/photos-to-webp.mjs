/**
 * One-shot re-encode of public/bar-photos/*.jpg → .webp (phone speed,
 * operator 2026-07-27: "optimize for speed on our phone app as much as
 * we can").
 *
 * The photo ingest saves what Google's media endpoint returns — 640px
 * JPEG, ~124 KB each. A results screen shows five cards, so a phone was
 * pulling ~620 KB of hero imagery per view. WebP at the same pixel width
 * lands around a third of that with no visible quality loss, and it
 * shrinks the repo/deploy at the same time.
 *
 * SAFETY: converts everything first, verifies 1:1 parity and that every
 * output is a readable image, and only then deletes the JPEGs. Re-runnable
 * (skips pairs that already exist). Pass --keep-jpg to convert without
 * deleting.
 *
 *   node scripts/photos-to-webp.mjs [--keep-jpg] [--quality 78]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = path.join(process.cwd(), 'public/bar-photos');
const KEEP = process.argv.includes('--keep-jpg');
const qArg = process.argv.indexOf('--quality');
const QUALITY = qArg !== -1 ? parseInt(process.argv[qArg + 1], 10) : 78;

const jpgs = fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg'));
if (jpgs.length === 0) {
  console.log('no .jpg files — nothing to do');
  process.exit(0);
}
console.log(`converting ${jpgs.length} JPEGs at quality ${QUALITY}…`);

let before = 0;
let after = 0;
let converted = 0;
let failed = 0;
const produced = [];

for (const file of jpgs) {
  const src = path.join(DIR, file);
  const dst = path.join(DIR, file.replace(/\.jpg$/, '.webp'));
  before += fs.statSync(src).size;
  try {
    if (!fs.existsSync(dst)) {
      await sharp(src).webp({ quality: QUALITY, effort: 5 }).toFile(dst);
      converted++;
    }
    after += fs.statSync(dst).size;
    produced.push({ src, dst });
    if (converted > 0 && converted % 250 === 0) {
      console.log(`  ${converted} converted…`);
    }
  } catch (err) {
    failed++;
    console.error(`FAIL ${file}: ${err.message}`);
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
  `\n${converted} converted, ${failed} failed. ${mb(before)} MB → ${mb(after)} MB ` +
    `(${(100 - (after / before) * 100).toFixed(0)}% smaller)`,
);

if (failed > 0) {
  console.error('FAILURES PRESENT — not deleting any JPEG.');
  process.exit(1);
}
if (KEEP) {
  console.log('--keep-jpg: leaving JPEGs in place.');
  process.exit(0);
}

// Verify every produced webp is a real, non-trivial image BEFORE deleting
// its source. A truncated write that still "exists" must not cost us the
// original.
console.log('verifying outputs…');
for (const { dst } of produced) {
  const meta = await sharp(dst).metadata();
  if (!meta.width || meta.width < 100 || fs.statSync(dst).size < 1000) {
    console.error(`SUSPECT OUTPUT ${dst} — aborting before any deletion.`);
    process.exit(1);
  }
}
for (const { src } of produced) fs.unlinkSync(src);
console.log(`verified ${produced.length} outputs; deleted ${produced.length} JPEGs.`);
