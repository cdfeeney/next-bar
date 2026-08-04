#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeCapacitorSpm(source) {
  return source.replace(
    /(\.package\(name:\s*"Capacitor[^"]+",\s*path:\s*")([^"]+)("\))/g,
    (_match, prefix, packagePath, suffix) =>
      `${prefix}${packagePath.replaceAll('\\', '/')}${suffix}`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const root = path.resolve(path.dirname(scriptPath), '..');
  const packageFile = path.join(
    root,
    'ios',
    'App',
    'CapApp-SPM',
    'Package.swift',
  );
  const before = readFileSync(packageFile, 'utf8');
  const after = normalizeCapacitorSpm(before);
  if (after !== before) writeFileSync(packageFile, after, 'utf8');
}
