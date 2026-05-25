import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Magic link callback handler.
 *
 * Supabase redirects here after the user taps the email link, with `?code=...`
 * in the query string. We exchange that code for a session, then redirect to
 * the app surface.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirect_to') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=missing_code`);
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/auth?error=supabase_unconfigured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
