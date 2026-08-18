import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VibeQuiz from './VibeQuiz';

// The server pass is the pre-hydration state a real tap lands in. If the
// options ship enabled there, the tap is discarded with no feedback — the
// defect that made three e2e specs fail on unrelated steps (see
// e2e/helpers/quizWalk.ts). Rendering on the server is the only place that
// window is observable deterministically: in the browser the effect that
// enables them has already run by the time a test can look.
describe('VibeQuiz server render', () => {
  test('option buttons are disabled until the component mounts', () => {
    const html = renderToStaticMarkup(<VibeQuiz onComplete={() => {}} />);

    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `enabled pre-hydration: ${button}`).toContain('disabled');
    }
  });
});
