import { describe, expect, it } from 'vitest';
import { canonicalFunctionBody } from './effectiveMigration';

describe('live function-body comparison', () => {
  const body = "\nbegin\n  -- guard\n  if auth.uid() is null then return false; end if;\n  perform 'public';\nend;\n";

  it('accepts LF, CRLF, and mixed transport line endings symmetrically', () => {
    const variants = [body, body.replace(/\n/g, '\r\n'), body.replace('\n', '\r\n')];
    for (const left of variants) {
      for (const right of variants) {
        expect(canonicalFunctionBody(left)).toBe(canonicalFunctionBody(right));
      }
    }
  });

  it.each([
    ['removed auth guard', body.replace('if auth.uid() is null then return false; end if;', '')],
    ['changed result', body.replace('return false', 'return true')],
    ['changed literal', body.replace("'public'", "'PUBLIC'")],
    ['changed comment', body.replace('-- guard', '-- changed')],
    ['changed spacing', body.replace('  perform', ' perform')],
    ['trailing whitespace', `${body} `],
    ['lone carriage return', body.replace('  perform', '\r  perform')],
  ])('still rejects %s', (_label, changed) => {
    expect(canonicalFunctionBody(changed)).not.toBe(canonicalFunctionBody(body));
  });
});
