/**
 * account-content-conflict.spec.ts — the returning-owner conflict dialog.
 *
 * This was the one interactive surface in AccountContentGate with no browser
 * coverage: account-content-gate.spec.ts covers its two siblings (foreign
 * residue, sign-out-with-unsynced) but never the three-way conflict choice.
 *
 * It is the choice worth covering most. "Keep account version" is an
 * explicit, permanent discard of the device copy
 * (src/lib/accountContentSync.ts:528-531) and, unlike the LWW path, nothing
 * stands behind it — no read-back, no server guard, no retry. A mis-wired
 * button loses the returning owner's data silently.
 *
 * The resolver itself is unit-tested (src/lib/accountContentSync.test.ts,
 * describe 'conflict resolution choices'); what is asserted here is the
 * DIALOG: that the right one renders, and that each button does its own job
 * and nothing else.
 *
 * Setup mirrors the state the resolver expects on a returning device: the
 * live local value is the ACCOUNT version (newer), and the device version
 * that never synced sits in the quarantine store as a retained conflict.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { fakeSignedIn, FAKE_USER_ID } from './helpers/fakeAuth';
// The envelope's digest is load-bearing — releaseQuarantinedEnvelope() checks
// it (accountContentSync.ts:530), so a hand-written digest would make every
// release silently no-op. Import the production identity function rather than
// reimplementing FNV-1a in the fixture: a copy would drift.
import { contentIdentity } from '../src/lib/accountContent.digest';

const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const OWNER_KEY = 'next-bar:account-content:owner:v1';
const QUARANTINE_KEY = 'next-bar:account-content:quarantine:v2';

/** Distinct bar ids so an upload body can be attributed to one side or the other. */
const DEVICE_MARKER = 'device-only-bar';
const ACCOUNT_MARKER = 'account-side-bar';

const DEVICE_ARCHIVE = [
  {
    nightKey: '2026-07-28',
    visits: [{ barId: DEVICE_MARKER, at: '2026-07-29T02:00:00.000Z' }],
  },
];

/** Newer than the device copy — this is the "account has a newer one" half. */
const ACCOUNT_ARCHIVE = [
  {
    nightKey: '2026-07-30',
    visits: [{ barId: ACCOUNT_MARKER, at: '2026-07-31T02:00:00.000Z' }],
  },
];

const DEVICE_IDENTITY = contentIdentity(DEVICE_ARCHIVE);

type StoredRow = {
  state_key: string;
  payload: unknown;
  client_updated_at: string;
};

type UploadTracker = { deviceUploads: number };

async function boot(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.goto('/nights');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

/**
 * Seed the live ACCOUNT value plus a retained-conflict envelope holding the
 * DEVICE value, under this user. The full store shape (version/rawInvalid/
 * pendingForeign/resolutionRequired) is written so the boot-time reader
 * cannot discard the seed as malformed.
 */
function seedConflict(page: Page): Promise<void> {
  return page.evaluate(
    ({ archiveKey, ownerKey, quarantineKey, account, device, owner, identity }) => {
      window.localStorage.setItem(archiveKey, JSON.stringify(account));
      window.localStorage.setItem(ownerKey, owner);
      window.localStorage.setItem(
        quarantineKey,
        JSON.stringify({
          version: 2,
          accounts: {
            [owner]: {
              night_archive: {
                data: device,
                clientUpdatedAt: '2026-07-29T02:00:00.000Z',
                digest: identity.digest,
                byteLength: identity.byteLength,
                quarantinedAt: '2026-07-29T03:00:00.000Z',
                status: 'conflict',
                confirmedAtCapture: null,
              },
            },
          },
          rawInvalid: {},
          pendingForeign: null,
          resolutionRequired: [],
        }),
      );
    },
    {
      archiveKey: ARCHIVE_KEY,
      ownerKey: OWNER_KEY,
      quarantineKey: QUARANTINE_KEY,
      account: ACCOUNT_ARCHIVE,
      device: DEVICE_ARCHIVE,
      owner: FAKE_USER_ID,
      identity: DEVICE_IDENTITY,
    },
  );
}

/**
 * Own the account_content_state endpoint (registered AFTER fakeSignedIn, so
 * it wins over that helper's catch-all REST stub).
 *
 * Uploads are counted BY PAYLOAD, not by request count. Ordinary forward sync
 * may legitimately POST the live account value during boot; counting every
 * POST would fail the negative assertions for a reason that has nothing to do
 * with the dialog. Only a body carrying the device marker is a device upload.
 *
 * A device upload is echoed back on the subsequent single-row read, because
 * uploadAndConfirm() refuses to call an unconfirmed write done — without the
 * echo the use-device path could never reach its success branch.
 */
async function stubAccountContentState(page: Page): Promise<UploadTracker> {
  const tracker: UploadTracker = { deviceUploads: 0 };
  let storedRow: StoredRow | null = null;

  await page.route('**/rest/v1/account_content_state**', async (route) => {
    const request = route.request();

    if (request.method() === 'POST') {
      const body = request.postData() ?? '';
      if (body.includes(DEVICE_MARKER)) {
        tracker.deviceUploads += 1;
        try {
          const parsed: unknown = JSON.parse(body);
          const row = (Array.isArray(parsed) ? parsed[0] : parsed) as StoredRow;
          storedRow = {
            state_key: row.state_key,
            payload: row.payload,
            client_updated_at: row.client_updated_at,
          };
        } catch {
          // Leave storedRow null: an unparseable upload must NOT confirm.
        }
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: '[]',
      });
    }

    // Single-row read-back (.maybeSingle()) wants an object or null; the
    // fetch-all variant wants an array. They share this URL, so branch on the
    // state_key filter rather than guessing.
    const singleRow = request.url().includes('state_key=eq.');
    if (singleRow) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(storedRow),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: storedRow ? JSON.stringify([storedRow]) : '[]',
    });
  });

  return tracker;
}

function readEnvelope(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ quarantineKey, owner }) => {
      const store = JSON.parse(
        window.localStorage.getItem(quarantineKey) ?? '{}',
      ) as { accounts?: Record<string, Record<string, unknown>> };
      const envelope = store.accounts?.[owner]?.night_archive;
      return envelope === undefined ? null : JSON.stringify(envelope);
    },
    { quarantineKey: QUARANTINE_KEY, owner: FAKE_USER_ID },
  );
}

function readLiveArchive(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, ARCHIVE_KEY);
}

test.describe('returning owner — content conflict dialog', () => {
  // Same budget accommodation as account-content-gate.spec.ts: auth
  // resolution alone has been observed above 20s under full parallel load.
  test.slow();

  async function open(page: Page, context: Parameters<typeof fakeSignedIn>[0]) {
    await boot(page);
    const ok = await fakeSignedIn(context, page);
    if (!ok) return null;
    const tracker = await stubAccountContentState(page);
    await seedConflict(page);
    await page.reload();

    // The RIGHT dialog, named for the domain in conflict — asserted before
    // any choice is made, so a passing choice-assertion can never be a
    // click on some other surface.
    const dialog = page.getByTestId('content-conflict-dialog-night_archive');
    await expect(dialog).toBeVisible({ timeout: 45_000 });
    await expect(dialog).toContainText('Two versions of Night history');
    // NEGATIVE: the sibling dialogs must not be what we are looking at.
    await expect(page.getByTestId('foreign-residue-dialog')).toHaveCount(0);
    return { dialog, tracker };
  }

  test('Decide later preserves the envelope byte-for-byte and uploads nothing', async ({
    page,
    context,
  }) => {
    const opened = await open(page, context);
    test.skip(opened === null, 'no Supabase URL configured');
    const { dialog, tracker } = opened!;

    const before = await readEnvelope(page);
    expect(before).not.toBeNull();

    await dialog.getByRole('button', { name: 'Decide later' }).click();
    await expect(dialog).toHaveCount(0);

    // The envelope survives untouched — same serialized bytes, still a conflict.
    const after = await readEnvelope(page);
    expect(after).toBe(before);
    expect(JSON.parse(after!)).toMatchObject({
      status: 'conflict',
      digest: DEVICE_IDENTITY.digest,
    });
    // NEGATIVE: deferring is not a decision — nothing was sent, nothing local changed.
    expect(tracker.deviceUploads).toBe(0);
    expect(await readLiveArchive(page)).toEqual(ACCOUNT_ARCHIVE);
  });

  test('Keep account version discards the device envelope without uploading it', async ({
    page,
    context,
  }) => {
    const opened = await open(page, context);
    test.skip(opened === null, 'no Supabase URL configured');
    const { dialog, tracker } = opened!;

    await dialog.getByRole('button', { name: 'Keep account version' }).click();
    await expect(dialog).toHaveCount(0);

    // The device copy is released — this choice IS the explicit discard.
    await expect.poll(() => readEnvelope(page), { timeout: 30_000 }).toBeNull();
    // NEGATIVE: a discard must never reach the server, and must never quietly
    // become the local value.
    expect(tracker.deviceUploads).toBe(0);
    expect(await readLiveArchive(page)).toEqual(ACCOUNT_ARCHIVE);
  });

  test('Use device version uploads the device value, keeps it locally, and only then releases', async ({
    page,
    context,
  }) => {
    const opened = await open(page, context);
    test.skip(opened === null, 'no Supabase URL configured');
    const { dialog, tracker } = opened!;

    await dialog.getByRole('button', { name: 'Use device version' }).click();
    await expect(dialog).toHaveCount(0);

    // The device value went up…
    await expect
      .poll(() => tracker.deviceUploads, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // …became the live local value…
    await expect
      .poll(() => readLiveArchive(page), { timeout: 30_000 })
      .toEqual(DEVICE_ARCHIVE);
    // …and only then was the envelope released.
    await expect.poll(() => readEnvelope(page), { timeout: 30_000 }).toBeNull();
  });
});
