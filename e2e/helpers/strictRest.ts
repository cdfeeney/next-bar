import { expect, type Page } from './test';

type UnexpectedRequest = { method: string; url: string; body: unknown };
const unexpectedByPage = new WeakMap<Page, UnexpectedRequest[]>();

/** Register before specific stubs: Playwright tries the newest route first. */
export async function stubStrictRest(page: Page): Promise<void> {
  if (unexpectedByPage.has(page)) return;
  const unexpected: UnexpectedRequest[] = [];
  unexpectedByPage.set(page, unexpected);
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    let body: unknown = request.postData();
    try {
      body = request.postDataJSON();
    } catch {
      // Preserve non-JSON bodies as text in the failure report.
    }
    unexpected.push({ method: request.method(), url: request.url(), body });
    await route.fulfill({
      status: 500,
      json: { message: 'Unexpected REST request: no specific test fixture answered it' },
    });
  });
}

export function assertNoUnexpectedRest(page: Page): void {
  const unexpected = unexpectedByPage.get(page) ?? [];
  expect(unexpected, `Unexpected REST requests:\n${JSON.stringify(unexpected, null, 2)}`).toEqual([]);
}
