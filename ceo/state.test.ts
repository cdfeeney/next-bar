import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import state from './state.json';
import { validateCeoState } from './state.schema.mjs';

function parseFrontmatter(document: string) {
  const match = document.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match === null) {
    throw new Error('Decision document is missing YAML frontmatter');
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const separator = line.indexOf(':');
        if (separator < 1) {
          throw new Error('Unsupported frontmatter line: ' + line);
        }
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim(),
        ];
      }),
  );
}

function parseKillCriterion(frontmatterValue: string | undefined) {
  if (frontmatterValue === undefined) {
    throw new Error('Decision frontmatter is missing kill_criterion');
  }

  const deadline = frontmatterValue.match(/\bby (\d{4}-\d{2}-\d{2})\b/);
  const wau = frontmatterValue.match(
    /\bfewer than (\d+) weekly-active users\b/,
  );
  const venues = frontmatterValue.match(
    /\bfewer than (\d+) self-maintaining claimed venues\b/,
  );

  if (deadline === null || wau === null || venues === null) {
    throw new Error(
      'Decision frontmatter kill_criterion does not match the supported prose shape',
    );
  }

  return {
    deadline: deadline[1],
    wau_threshold: Number(wau[1]),
    venue_threshold: Number(venues[1]),
  };
}

describe('CEO state', () => {
  it('validates against the hand-rolled schema', () => {
    expect(validateCeoState(state)).toEqual({ valid: true, errors: [] });
  });

  it('keeps kill_criterion values in parity with decision frontmatter', () => {
    const decisionDocument = readFileSync(
      path.resolve(
        process.cwd(),
        'decisions/2026-07-25-next-bar-monetization.md',
      ),
      'utf8',
    );
    const frontmatter = parseFrontmatter(decisionDocument);
    const authoritativeCriterion = parseKillCriterion(
      frontmatter.kill_criterion,
    );

    expect({
      deadline: state.kill_criterion.deadline,
      wau_threshold: state.kill_criterion.wau_threshold,
      venue_threshold: state.kill_criterion.venue_threshold,
    }).toEqual(authoritativeCriterion);
  });
});
