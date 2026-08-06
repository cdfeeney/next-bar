/**
 * account-content-gate.spec.ts (goal g-5cb22f54 — persistence v2.1)
 *
 * The preservation gate's interactive surfaces:
 *   - Foreign residue: another account's content on the device → quarantined
 *     under its owner, FIRST FRAME renders empty (negative), dialog offers
 *     Keep-it-for-them / Delete-permanently.
 *   - Involuntary residue signed-out: quarantined inert, app renders empty.
 *   - Voluntary sign-out with unsynced content: Retry / named Discard /
 *     Cancel. Cancel signs nothing out and deletes nothing (negative).
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { fakeSignedIn, FAKE_USER_ID } from './helpers/fakeAuth';

const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const OWNER_KEY = 'next-bar:account-content:owner:v1';
const QUARANTINE_KEY = 'next-bar:account-content:quarantine:v2';
const OTHER_USER = '99999999-8888-7777-6666-555555555555';

const FOREIGN_ARCHIVE = [
  {
    nightKey: '2026-07-30',
    visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
  },
];

async function boot(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.goto('/nights');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

function seedForeignResidue(page: Page): Promise<void> {
  return page.evaluate(
    ({ archiveKey, ownerKey, archive, owner }) => {
      window.localStorage.setItem(archiveKey, JSON.stringify(archive));
      window.localStorage.setItem(ownerKey, owner);
    },
    {
      archiveKey: ARCHIVE_KEY,
      ownerKey: OWNER_KEY,
      archive: FOREIGN_ARCHIVE,
      owner: OTHER_USER,
    },
  );
}

test.describe('foreign residue — quarantine, negative render, resolution', () => {
  // Same machine-contention accommodation as the sign-out describe below:
  // auth resolution alone has been observed to take >20s under full
  // parallel load. Budgets, not behavior.
  test.slow();

  test('first frame renders EMPTY, the dialog appears, Keep-it-for-them preserves the envelope', async ({
    page,
    context,
  }) => {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await seedForeignResidue(page);
    await page.reload();

    // The preservation machinery must flag the foreign residue…
    await expect
      .poll(
        () =>
          page.evaluate(
            (quarantineKey) =>
              (
                JSON.parse(
                  window.localStorage.getItem(quarantineKey) ?? '{}',
                ) as { pendingForeign?: { ownerUserId: string } | null }
              ).pendingForeign?.ownerUserId ?? null,
            QUARANTINE_KEY,
          ),
        { timeout: 45_000 },
      )
      .toBe(OTHER_USER);
    // …and the gate must SURFACE it. NEGATIVE first-frame render below: the
    // foreign night itself never appears.
    await expect(page.getByTestId('foreign-residue-dialog')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText('No nights yet.')).toBeVisible();
    await expect(page.getByText(/July 30/)).toHaveCount(0);

    // The residue was preserved under ITS owner before the user chose.
    const quarantined = await page.evaluate(
      ({ quarantineKey, owner }) => {
        const store = JSON.parse(
          window.localStorage.getItem(quarantineKey) ?? '{}',
        ) as { accounts?: Record<string, Record<string, { data: unknown }>> };
        return store.accounts?.[owner]?.night_archive?.data ?? null;
      },
      { quarantineKey: QUARANTINE_KEY, owner: OTHER_USER },
    );
    expect(quarantined).toEqual(FOREIGN_ARCHIVE);

    await page
      .getByRole('button', { name: 'Keep it for them' })
      .click();
    await expect(page.getByTestId('foreign-residue-dialog')).toHaveCount(0);
    // Still empty for THIS user; envelope retained for the other account.
    await expect(page.getByText('No nights yet.')).toBeVisible();
    const kept = await page.evaluate(
      ({ quarantineKey, owner }) => {
        const store = JSON.parse(
          window.localStorage.getItem(quarantineKey) ?? '{}',
        ) as { accounts?: Record<string, Record<string, unknown>> };
        return Boolean(store.accounts?.[owner]?.night_archive);
      },
      { quarantineKey: QUARANTINE_KEY, owner: OTHER_USER },
    );
    expect(kept).toBe(true);
  });

  test('Delete permanently drops the envelope only after the confirm', async ({
    page,
    context,
  }) => {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await seedForeignResidue(page);
    await page.reload();

    await expect(page.getByTestId('foreign-residue-dialog')).toBeVisible({
      timeout: 45_000,
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByTestId('foreign-residue-dialog')).toHaveCount(0);

    const remaining = await page.evaluate(
      ({ quarantineKey, owner }) => {
        const store = JSON.parse(
          window.localStorage.getItem(quarantineKey) ?? '{}',
        ) as { accounts?: Record<string, unknown> };
        return store.accounts?.[owner] ?? null;
      },
      { quarantineKey: QUARANTINE_KEY, owner: OTHER_USER },
    );
    expect(remaining === null || Object.keys(remaining).length === 0).toBe(true);
  });
});

test.describe('involuntary residue, signed out', () => {
  test.slow();

  test('owned residue quarantines inert — anonymous session renders empty, data preserved', async ({
    page,
  }) => {
    await boot(page);
    await seedForeignResidue(page); // owner marker, NO session → involuntary
    await page.reload();

    await expect(page.getByText('No nights yet.')).toBeVisible();
    await expect(page.getByText(/July 30/)).toHaveCount(0);
    // The inert-quarantine move waits on auth resolving signed-out — poll
    // rather than snapshot (the empty render above also exists pre-move).
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ quarantineKey, owner }) => {
              const store = JSON.parse(
                window.localStorage.getItem(quarantineKey) ?? '{}',
              ) as {
                accounts?: Record<string, Record<string, { data: unknown }>>;
              };
              return store.accounts?.[owner]?.night_archive?.data ?? null;
            },
            { quarantineKey: QUARANTINE_KEY, owner: OTHER_USER },
          ),
        { timeout: 45_000 },
      )
      .toEqual(FOREIGN_ARCHIVE);
    // No dialog signed-out: resolution is a signed-in decision.
    await expect(page.getByTestId('foreign-residue-dialog')).toHaveCount(0);
  });
});

test.describe('voluntary sign-out with unsynced content', () => {
  // The settings page is the heaviest route (profile + taste + catalog
  // joins); under full-file parallel load the webkit project's click
  // stability checks alone exceed the default 30s (observed: passes in
  // 6.1s isolated, times out at 30.5s under contention — same pattern the
  // nights-history busy-state spec documents). Budget, not restructure.
  test.slow();

  async function seedOwnDirtyContent(page: Page): Promise<void> {
    await page.evaluate(
      ({ archiveKey, ownerKey, archive, owner }) => {
        window.localStorage.setItem(archiveKey, JSON.stringify(archive));
        window.localStorage.setItem(ownerKey, owner);
      },
      {
        archiveKey: ARCHIVE_KEY,
        ownerKey: OWNER_KEY,
        archive: FOREIGN_ARCHIVE,
        owner: FAKE_USER_ID,
      },
    );
  }

  test('the dialog names the unsynced domains; Cancel signs nothing out and deletes nothing', async ({
    page,
    context,
  }) => {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    let logoutCalls = 0;
    await page.route('**/auth/v1/logout**', (route) => {
      logoutCalls += 1;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/settings');
    await seedOwnDirtyContent(page);
    await page.reload();

    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByTestId('signout-unsynced-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Night history');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // NEGATIVE: still signed in, nothing deleted, no logout request.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(logoutCalls).toBe(0);
    const archive = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ARCHIVE_KEY,
    );
    expect(archive).toBe(JSON.stringify(FOREIGN_ARCHIVE));
  });

  test('Discard requires the NAMED confirmation, then signs out with the items removed', async ({
    page,
    context,
  }) => {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    let logoutCalls = 0;
    await page.route('**/auth/v1/logout**', (route) => {
      logoutCalls += 1;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/settings');
    await seedOwnDirtyContent(page);
    await page.reload();

    const messages: string[] = [];
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      return dialog.accept();
    });

    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByTestId('signout-unsynced-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard and sign out' }).click();

    // The confirmation NAMED the discarded domain.
    await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1);
    expect(messages[0]).toContain('Night history');
    await expect.poll(() => logoutCalls, { timeout: 10_000 }).toBeGreaterThan(0);
    const archive = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ARCHIVE_KEY,
    );
    expect(archive).toBeNull();
  });

  test('Retry that cannot confirm stays honest: no sign-out, content intact', async ({
    page,
    context,
  }) => {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    let logoutCalls = 0;
    await page.route('**/auth/v1/logout**', (route) => {
      logoutCalls += 1;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/settings');
    await seedOwnDirtyContent(page);
    await page.reload();

    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByTestId('signout-unsynced-dialog');
    await expect(dialog).toBeVisible();
    // The generic REST stub answers uploads with an empty read-back — the
    // engine correctly refuses to call that confirmed.
    await dialog.getByRole('button', { name: 'Retry sync' }).click();
    await expect(dialog.getByRole('status')).toContainText(/still unsynced/i);
    expect(logoutCalls).toBe(0);
    const archive = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ARCHIVE_KEY,
    );
    expect(archive).toBe(JSON.stringify(FOREIGN_ARCHIVE));
  });
});
