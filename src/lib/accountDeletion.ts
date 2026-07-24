/**
 * Client side of H2 account deletion (N3): calls our OWN API route, which
 * holds the service-role key server-side. The caller proves identity with
 * their access token; the route deletes that verified user and nobody
 * else. False on ANY failure — the UI treats it as "nothing was deleted"
 * (the server makes that true: deletion is all-or-nothing per user).
 */
export async function requestAccountDeletion(
  accessToken: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}
