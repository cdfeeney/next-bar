/**
 * Merge one or more nearby-sweep JSON files into a deduplicated review queue.
 * JSON retains all evidence; CSV is the compact checklist for manual review.
 *
 * node scripts/merge-coverage-sweeps.mjs <input.json> [...] \
 *   --out scripts/data/west-side.json --csv scripts/data/west-side.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergeCoverageCandidates } from './lib/coverage-search.mjs';

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
};
const out = valueFor('--out');
const csv = valueFor('--csv');
const consumed = new Set();
for (const flag of ['--out', '--csv']) {
  const index = args.indexOf(flag);
  if (index !== -1) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) {
      console.error(`${flag} needs a value`);
      process.exit(1);
    }
    consumed.add(index);
    consumed.add(index + 1);
  }
}
const inputs = args.filter((_, index) => !consumed.has(index));
if (inputs.length === 0 || !out) {
  console.error('usage: node scripts/merge-coverage-sweeps.mjs <input.json> [...] --out <merged.json> [--csv <review.csv>]');
  process.exit(1);
}

const groups = inputs.map((file) => {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array`);
  return parsed;
});
const merged = mergeCoverageCandidates(groups);

function writeFile(file, value) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, value);
  console.log(`wrote ${resolved}`);
}

writeFile(out, `${JSON.stringify(merged, null, 2)}\n`);
if (csv) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const columns = [
    'tier',
    'score',
    'name',
    'decision',
    'notes',
    'address',
    'primaryType',
    'regions',
    'sources',
    'requestedNames',
    'website',
    'googleMaps',
    'placeId',
  ];
  const rows = [
    columns.join(','),
    ...merged.map((candidate) =>
      columns
        .map((column) => {
          const value = candidate[column];
          return quote(Array.isArray(value) ? value.join(' | ') : value);
        })
        .join(','),
    ),
  ];
  writeFile(csv, `${rows.join('\n')}\n`);
}

const likely = merged.filter((candidate) => candidate.tier === 'likely_bar').length;
console.log(
  `${groups.reduce((count, group) => count + group.length, 0)} input rows -> ${merged.length} unique candidates (${likely} likely, ${merged.length - likely} review)`,
);
