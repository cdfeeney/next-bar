import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  readApnsConfig,
  sendApnsNotification,
  buildProviderToken,
} from '@/lib/apnsSender';
import { buildDrainDeps } from '@/lib/notificationDrainDeps';
import { drainNotificationOutbox } from '@/lib/notificationOutbox';

/**
 * POST /api/notifications/drain — send whatever the outbox has queued.
 *
 * The outbox is written by database triggers (0061); something has to drain
 * it. This is that something: a small, secret-guarded endpoint a scheduler can
 * poke. All the delivery RULES live in src/lib/notificationOutbox.ts and every
 * database adapter lives in src/lib/notificationDrainDeps.ts — both unit-tested
 * there. This file is only the guards and the wiring.
 *
 * SECURITY MODEL (same shape as /api/account/delete):
 *   - SUPABASE_SERVICE_ROLE_KEY and every APNS_* variable are read server-side
 *     from env ONLY. None carry a NEXT_PUBLIC_ prefix, so Next.js can never
 *     inline them into a client bundle; scripts/check-client-apns-bundle.mjs
 *     proves that against the built output.
 *   - The caller proves nothing about identity — it is not a user endpoint. It
 *     presents a shared secret in a header, compared with a length-safe
 *     constant-time comparison. Without NOTIFICATIONS_DRAIN_SECRET set, the
 *     route is CLOSED, not open: an unset secret is a missing answer, never
 *     permission.
 *   - Errors are generic to the caller; detail stays in server logs, and no
 *     log line here ever contains a device token or a credential.
 *
 * STAGING ONLY. readApnsConfig throws on any APNS_ENVIRONMENT other than
 * `sandbox`, so a production sender cannot be switched on by configuration.
 *
 * UNATTENDED SAFETY GATE: under LOOP_UNATTENDED=1 this refuses outright. An
 * overnight loop must never push real notifications to a real phone.
 */

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.LOOP_UNATTENDED === '1') {
    console.error(
      '[notifications/drain] refused: LOOP_UNATTENDED=1 — unattended safety gate.',
    );
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const secret = process.env.NOTIFICATIONS_DRAIN_SECRET;
  const presented = request.headers.get('x-notifications-secret') ?? '';
  if (!secret || !timingSafeEqual(secret, presented)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Checked AFTER authentication on purpose: a 503 here tells the caller how
  // this deployment is configured, and an unauthenticated caller is owed
  // nothing but 401.
  // "Staging only" was enforced entirely by readApnsConfig refusing a
  // non-sandbox APNS_ENVIRONMENT — which constrains WHICH APNs it talks to and
  // says nothing about WHICH DATABASE it drains (cold panel, Codex, HIGH). This
  // route reads the outbox with the service-role key and sends real pushes to
  // real phones; it must also refuse to run against production data.
  //
  // Fail closed: an unset label is a missing answer, not permission — the same
  // rule the live RLS suite and the migration-set applier already use.
  const dbEnvironment = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;
  if (dbEnvironment !== 'staging') {
    console.error(
      `[notifications/drain] refused: NEXT_BAR_DATABASE_ENVIRONMENT is ${
        dbEnvironment ? JSON.stringify(dbEnvironment) : 'unset'
      }, and this is a staging-only feature.`,
    );
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }


  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  let config;
  try {
    config = readApnsConfig();
  } catch (thrown) {
    // A production APNS_ENVIRONMENT lands here. Loud, because it is a
    // misconfiguration of a deliberately staging-only feature.
    console.error('[notifications/drain] refused:', (thrown as Error).message);
    return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 });
  }
  if (!config) {
    // The APNs key is an attended credential. Until it exists the outbox
    // simply accumulates; that is the designed state, not a failure.
    return NextResponse.json(
      { ok: true, skipped: 'apns_not_configured' },
      { status: 200 },
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // One provider token per drain: Apple rejects tokens older than an hour and
  // rate-limits re-minting, so it is generated once and reused for the batch.
  const providerToken = buildProviderToken(
    config,
    Math.floor(Date.now() / 1000),
  );

  const deps = buildDrainDeps(admin, (deviceToken, payload) =>
    sendApnsNotification(
      config,
      { deviceToken, payload, collapseId: payload.nightOutToken },
      undefined,
      providerToken,
    ),
  );

  try {
    const summary = await drainNotificationOutbox(deps, BATCH_SIZE);
    return NextResponse.json({ ok: true, ...summary });
  } catch (thrown) {
    console.error('[notifications/drain] failed:', thrown);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
