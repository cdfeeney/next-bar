import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { VibeProfile } from '@/types';

type WaitlistPayload = {
  email?: string;
  neighborhood?: string;
  vibe_profile?: VibeProfile | null;
};

export async function POST(request: Request) {
  let body: WaitlistPayload;
  try {
    body = (await request.json()) as WaitlistPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { email, neighborhood, vibe_profile } = body;

  if (!email) {
    return NextResponse.json({ ok: false, error: 'missing_email' }, { status: 400 });
  }

  if (supabase) {
    const { error } = await supabase
      .from('waitlist')
      .insert({ email, neighborhood, vibe_profile });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  } else {
    console.log('[waitlist]', { email, neighborhood, vibe_profile });
  }

  return NextResponse.json({ ok: true });
}
