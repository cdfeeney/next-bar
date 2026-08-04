/**
 * Print only the non-secret, effective Capacitor build identity consumed by
 * local preflight and CI. The config itself rejects credential-bearing URLs.
 */
import type { CapacitorConfig } from '@capacitor/cli';
import importedConfig from '../capacitor.config.ts';

// tsx loads this .mts helper through ESM while Capacitor's TypeScript config
// may be transpiled through CommonJS interop. Normalize either module shape.
const candidate = importedConfig as CapacitorConfig & {
  default?: CapacitorConfig;
};
const config = candidate.appId ? candidate : (candidate.default ?? candidate);

process.stdout.write(
  JSON.stringify({
    appId: config.appId,
    appName: config.appName,
    webDir: config.webDir,
    serverUrl: config.server?.url ?? null,
    allowNavigation: config.server?.allowNavigation ?? [],
  }),
);
