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

function isServiceKey(token: string, serviceKey: string): boolean {
  const presented = Buffer.from(token);
  const expected = Buffer.from(serviceKey);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
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
  if (isServiceKey(token, env.serviceKey)) {
    const swept = await sweepReclaimable(admin, admin);
    return NextResponse.json({
      ok: true,
      scope: 'all',
      reclaimed: swept.reclaimed.length,
      orphanedPaths: swept.orphaned,
    });
  }

  const userId = await verifiedUserId(admin, token);
  if (userId === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const swept = await sweepReclaimable(callerClient(env, token), admin);
  return NextResponse.json({
    ok: true,
    scope: 'own',
    reclaimed: swept.reclaimed.length,
    orphanedPaths: swept.orphaned,
  });
}
