/**
 * WHICH PROJECT IS PRODUCTION COMES FROM REPO-ROOT `.env.local` ONLY; THE LABEL IS DERIVED FROM THE
 * REF; THERE IS NO SECOND LIST.
 *
 * One reader, shared by every database entry point. It existed three times as a private helper and
 * that is how the third write path (`apply-one-migration.mts`, now deleted) kept its own weaker
 * rules: a duplicated guard is a guard that will disagree with itself eventually.
 *
 * Read from the FILE, never `process.env`: a `--secrets-file` loads with `override: true` and could
 * otherwise supply or shadow the operator's classification, letting the file being pointed at
 * decide what it is allowed to be.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseEnv } from 'dotenv';

import {
  assertCoherentClassification, DEFAULT_DATABASE, TargetRefusal, type Classification,
} from './migration-target-guard';

const split = (value: string | undefined): string[] => (value ?? '')
  .split(/[,\s]+/)
  .map((ref) => ref.trim().toLowerCase())
  .filter(Boolean);

/**
 * The operator's classification, validated. Throws TargetRefusal when the file is missing, when
 * NEXT_BAR_PRODUCTION_PROJECT_REF is absent, or when a ref appears in more than one list.
 */
export function readClassification(cwd: string = process.cwd()): Classification {
  const path = join(cwd, '.env.local');
  if (!existsSync(path)) {
    throw new TargetRefusal(
      `${path} does not exist; the operator-set project lists live only there`,
    );
  }
  const parsed = parseEnv(readFileSync(path));
  const classification: Classification = {
    productionRef: (parsed.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '').trim().toLowerCase() || null,
    stagingRefs: split(parsed.NEXT_BAR_STAGING_PROJECT_REFS),
    developmentRefs: split(parsed.NEXT_BAR_DEVELOPMENT_PROJECT_REFS),
    // Absent means the Supabase default; present-but-empty is refused downstream rather than
    // silently treated as "no expectation".
    expectedDatabase: parsed.NEXT_BAR_DATABASE_NAME === undefined
      ? DEFAULT_DATABASE
      : parsed.NEXT_BAR_DATABASE_NAME,
  };
  assertCoherentClassification(classification);
  return classification;
}
