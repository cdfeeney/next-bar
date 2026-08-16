import { storePendingInvite as storePendingInviteDefault } from '@/lib/pendingInvite';

/**
 * Push-payload routing (V8-4) — PURE logic, no Capacitor import. The server
 * sends `{ nightOutToken, eventType }` as the APNs custom payload; this
 * module turns that into an app path, or refuses to if the payload is
 * malformed. Used both for a cold launch (tapping a notification that
 * starts the app) and for a warm foreground tap — same function either way.
 *
 * The token is validated with a UUID regex before it ever touches a path
 * string — never interpolate unvalidated push-payload data into a route.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Exactly the four PRD event types (0051's notification_preferences columns)
// — no fifth type.
const EVENT_TYPES = new Set([
  'invited',
  'accepted',
  'bar_suggested',
  'plan_changed',
]);

export type PushEventType =
  | 'invited'
  | 'accepted'
  | 'bar_suggested'
  | 'plan_changed';

export type PushPayload = {
  nightOutToken: string;
  eventType: PushEventType;
};

function parsePushPayload(data: unknown): PushPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const token = record.nightOutToken;
  const eventType = record.eventType;
  if (typeof token !== 'string' || !UUID_RE.test(token)) return null;
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType)) return null;
  return { nightOutToken: token, eventType: eventType as PushEventType };
}

/** The app path for a push payload, or null when the payload is malformed — missing/non-UUID token, unknown event type. */
export function routeForPushPayload(data: unknown): string | null {
  const payload = parsePushPayload(data);
  return payload === null ? null : `/night-out/${payload.nightOutToken}`;
}

export type PushNavigationContext = {
  isSignedIn: boolean;
  navigate: (path: string) => void;
  /** Injected for testability; defaults to the real pendingInvite.ts helper. */
  storePendingInvite?: (token: string) => void;
};

/**
 * Cold launch (tapping a notification that starts the app) and a warm
 * foreground tap both funnel through here — same handoff either way.
 *
 * Signed in: navigate straight to the plan.
 * Signed out: store the token as a pending invite (consumed by
 * PendingInviteRedirect after the user signs in — the same handoff the
 * share-link flow uses) AND navigate to the same share route, so the
 * existing signed-out preview renders immediately rather than the user
 * staring at nothing until they sign in.
 *
 * Returns whether navigation happened, so a caller can tell a malformed
 * payload from a handled one.
 */
export function handlePushNavigation(
  data: unknown,
  { isSignedIn, navigate, storePendingInvite = storePendingInviteDefault }: PushNavigationContext,
): boolean {
  const payload = parsePushPayload(data);
  if (payload === null) return false;
  if (!isSignedIn) storePendingInvite(payload.nightOutToken);
  navigate(`/night-out/${payload.nightOutToken}`);
  return true;
}
