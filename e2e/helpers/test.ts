import { test as base } from '@playwright/test';

export * from '@playwright/test';

// Exercise the vector renderer without sending the full suite to a public service.
// Live NYC appearance is checked separately with unmocked tiles.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({
      contentType: 'application/json',
      json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c0c0c' } }] },
    }));
    await context.route(/^https:\/\/(?:[a-d]\.basemaps\.cartocdn\.com|tile\.openstreetmap\.org)\//, route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ddd"/></svg>',
    }));
    await use(context);
  },
});
