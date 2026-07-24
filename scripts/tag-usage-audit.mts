/**
 * N7 (B5c-1) calibration tool: per-tag usage counts across the FULL bar
 * catalog + which tags the quiz can actually emit. Feeds
 * docs/TAG-AUDIT-2026-07-25.md. Read-only; no network.
 * Run: npx tsx scripts/tag-usage-audit.mts
 */
import { getBarsSnapshot, TAG_VOCABULARY } from '../src/lib/catalog';
import { quiz as QUIZ_QUESTIONS } from '../src/lib/quiz';

const bars = getBarsSnapshot();
const counts = new Map<string, number>(TAG_VOCABULARY.map((t) => [t, 0]));
const open = bars.filter((b) => b.businessStatus !== 'CLOSED_PERMANENTLY');
for (const bar of open) {
  for (const tag of bar.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
}

const quizTags = new Set<string>();
for (const q of QUIZ_QUESTIONS) {
  if (q.kind !== 'single') continue; // neighborhood multi-select carries no tags
  for (const opt of q.options) for (const t of opt.tags) quizTags.add(t);
}

const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`bars total=${bars.length} open=${open.length}`);
console.log('tag,count,pctOfOpenBars,quizEmits');
for (const [tag, count] of rows) {
  const pct = ((100 * count) / open.length).toFixed(1);
  console.log(`${tag},${count},${pct}%,${quizTags.has(tag) ? 'yes' : 'NO'}`);
}
console.log(`\nquiz-emittable tags: ${quizTags.size}/${TAG_VOCABULARY.length}`);
// Pairwise co-occurrence for likely-overlapping tags (top pairs).
const pairs = new Map<string, number>();
for (const bar of open) {
  const tags = [...bar.tags].sort();
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++) {
      const key = `${tags[i]}+${tags[j]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
}
const topPairs = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\ntop co-occurring pairs:');
for (const [pair, n] of topPairs) console.log(`${pair}: ${n}`);
