/**
 * Score a reviewed coverage queue against labelled golden fixtures.
 *
 * Offline and deterministic — no network, no credentials. Run it after any
 * change to the sweep or the review to see whether recall moved without
 * precision paying for it.
 *
 *   node scripts/coverage-evaluate.mjs --input reviewed.json
 *   node scripts/coverage-evaluate.mjs --input reviewed.json --json report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluateCoverage, formatEvaluation } from './lib/coverage-evaluator.mjs';

function parseArgs(argv) {
  const options = { goldens: 'scripts/fixtures/coverage-goldens.json' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!['--input', '--goldens', '--json'].includes(arg)) {
      throw new Error(`unknown option: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  if (!options.input) throw new Error('usage: coverage-evaluate.mjs --input <reviewed.json>');
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function readJsonArray(file) {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${file} must contain a JSON array`);
  return value;
}

const goldens = readJsonArray(options.goldens);
const rows = readJsonArray(options.input);
const report = evaluateCoverage(goldens, rows);
console.log(formatEvaluation(report));

if (options.json) {
  const resolved = path.resolve(options.json);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${resolved}`);
}
