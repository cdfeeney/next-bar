import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync('src/lib/bars.places.ts', 'utf8');
const markers = [...source.matchAll(/"googlePlaceId":"([^"]+)"/g)].map(
  (match) => match[1],
);
if (markers.length === 0) throw new Error('catalog bundle check: no Places markers found');

const root = '.next/static/chunks';
const files = [];
const visit = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (name.endsWith('.js')) files.push(path);
  }
};
visit(root);

const leaked = files.filter((path) => {
  const content = readFileSync(path, 'utf8');
  return markers.some((marker) => content.includes(marker));
});
const bytes = files.reduce((total, path) => total + statSync(path).size, 0);
console.log(JSON.stringify({ client_js_files: files.length, client_js_bytes: bytes, leaked }));
if (leaked.length > 0) process.exit(1);
