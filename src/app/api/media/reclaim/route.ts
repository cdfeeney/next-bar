import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { sweepReclaimable } from '@/lib/media/reclaim';
import {
  adminClient,
  bearerToken,
  callerClient,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';

/**
 * POST /api/media/reclaim — the reclamation tick (V8-R-CMP-012, V8-R-STO-016).
 *
 * "Bytes die with the last reference" needs something that actually kills them.
 * 0066 decides eligibility; nothing in the database can delete a Storage object,
 * so without an invoked caller expired stories, abandoned uploads and orphaned
 * bytes accumulate forever while every rule about them reads as satisfied.
 *
 * TWO CALLERS, ONE PASS:
 *
 *   A USER'S OWN TOKEN sweeps only that account's media. Every RPC behind this
 *   is caller-scoped, so the scoping is the database's and not this handler's.
 *
 *   THE SERVICE ROLE KEY, presented as the bearer, sweeps everyone's. That is
 *   the scheduled path — a cron hitting this route — and it is a service key
 *   rather than a new shared secret precisely so scheduling it is deployment
 *   configuration and not another credential to mint and rotate. Compared in
 *   constant time: a length-or-prefix comparison on a service key leaks it a
 *   byte at a time.
 *
 * Bounded per call. Whatever is left is picked up next tick, which is what makes
 * it safe to run this on a schedule OR from a request without either one
 * becoming a long job.
 */
export const runtime = 'nodejs';

function tokenMatches(token: string, secret: string): boolean {
  const presented = Buffer.from(token);
  const expected = Buffer.from(secret);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/**
 * GET /api/media/reclaim — the scheduled tick. `vercel.json` points a daily
 * cron here; Vercel invokes crons with GET and `Authorization: Bearer
 * ${CRON_SECRET}` (the platform's own env var — NOT the service key, which
 * this way never appears in deployment config). Same bounded global sweep as
 * the service-key POST. No CRON_SECRET configured = no scheduled path at all.
 */
/**
 * One answer shape for all three sweeps, so none of them can quietly report a
 * cleanup that did not happen.
 *
 * A sweep whose claim RPC errored or threw used to be indistinguishable from a
 * clean one — both produced empty lists — and this route answered 200
 * `ok: true` over it. For the CRON that is the worst possible combination: the
 * platform records a green invocation, nobody is paged, and the bucket grows.
 * 500 is right because the work was not done and the caller should retry or
 * alert, not because the request was malformed.
 */
function sweptResponse(
  scope: 'all' | 'own',
  swept: { reclaimed: string[]; orphaned: string[]; unchecked: string[] },
): NextResponse {
  if (swept.unchecked.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'sweep_incomplete',
        scope,
        // What DID land is still reported: some bytes really are gone, and a
        // caller retrying needs to know the run was partial rather than void.
        reclaimed: swept.reclaimed.length,
        orphanedPaths: swept.orphaned,
        unchecked: swept.unchecked,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    scope,
    reclaimed: swept.reclaimed.length,
    orphanedPaths: swept.orphaned,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const token = bearerToken(request);
  if (secret === undefined || secret === '' || token === null || !tokenMatches(token, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const env = readMediaEnv();
  if (env === null) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const admin = adminClient(env);
  const swept = await sweepReclaimable(admin, admin);
  return sweptResponse('all', swept);
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = readMediaEnv();
  if (env === null) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const token = bearerToken(request);
  if (token === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = adminClient(env);

  // SERVICE ROLE => GLOBAL SWEEP. Passing the admin client as the "caller" is
  // what makes it global: 0066's functions widen from "this account's media" to
  // "all media" exactly when `auth.uid()` is null, and a service-role client is
  // the only client for which it is.
  if (tokenMatches(token, env.serviceKey)) {
    const swept = await sweepReclaimable(admin, admin);
    return sweptResponse('all', swept);
  }

  const userId = await verifiedUserId(admin, token);
  if (userId === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const swept = await sweepReclaimable(callerClient(env, token), admin);
  return sweptResponse('own', swept);
}
