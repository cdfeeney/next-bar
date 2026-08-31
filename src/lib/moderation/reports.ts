import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaFailure, mediaUnavailable, type MediaResult } from '@/lib/media/types';

/**
 * Reporting content (V8-R-FEED-010).
 *
 * "Reporting IMMEDIATELY HIDES the reported content FOR THE REPORTER and
 * creates a SERVER-OWNED REPORT for operator review."
 *
 * The ORDER is the requirement, and it is the opposite of what feels
 * responsive: the hide follows the write, it does not precede it. The failure
 * clause says so outright — "if the report write fails, the content is NOT
 * hidden and the failure is stated — a silent hide would misrepresent that a
 * report exists." An optimistic hide would leave a user believing they had
 * reported something nobody will ever see.
 *
 * The hide is DERIVED from the report row rather than stored beside it
 * ({@link listReportedSubjects}), so the two cannot drift: content is hidden
 * for a reporter exactly while their report exists.
 *
 * No moderation dashboard is built here. The requirement excludes it: "NO NEW
 * MODERATION DASHBOARD is required in V8 — existing administrative tooling is
 * sufficient."
 */

/**
 * The EVENTUAL vocabulary, which is wider than what any single migration resolves.
 *
 * It does NOT match 0066's check constraint, and saying it did was wrong: EC-03
 * narrowed that constraint to ('story'), because feed_posts and comments arrive in
 * WP5's 0069 and group_messages in WP6's 0067, and a migration cannot check existence
 * or visibility against a table that does not exist yet. Those migrations widen the
 * constraint AND teach report_content the matching branch, together.
 *
 * The DATABASE is the authority on what is currently reportable. A kind listed here
 * but not yet admitted by the constraint is refused server-side with a clear message,
 * which is the correct failure for a surface that is coming rather than gone.
 */
export type ReportSubjectKind = 'story' | 'feed_post' | 'comment' | 'group_message';

export const REPORT_SUBJECT_KINDS: readonly ReportSubjectKind[] = [
  'story',
  'feed_post',
  'comment',
  'group_message',
];

export function isReportSubjectKind(value: unknown): value is ReportSubjectKind {
  return typeof value === 'string'
    && (REPORT_SUBJECT_KINDS as readonly string[]).includes(value);
}

/** Cap on the free-text reason. Long enough to be useful, bounded for storage. */
export const MAX_REPORT_REASON_LENGTH = 1000;

export type SubmittedReport = {
  reportId: string;
  /**
   * Whether the caller may now hide the content. True ONLY when the server
   * confirmed the report row — this is the flag that carries the requirement's
   * ordering into the UI.
   */
  hideForReporter: true;
};

/**
 * File a report. The content is hidden for the reporter only if this resolves
 * `ok`.
 */
export async function reportContent(
  client: SupabaseClient | null,
  subjectKind: ReportSubjectKind,
  subjectRef: string,
  reason: string | null = null,
): Promise<MediaResult<SubmittedReport>> {
  if (client === null) return mediaUnavailable();

  if (!isReportSubjectKind(subjectKind)) {
    return mediaFailure('rejected', 'That cannot be reported.');
  }
  if (subjectRef.trim().length === 0) {
    return mediaFailure('rejected', 'That cannot be reported.');
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length > MAX_REPORT_REASON_LENGTH) {
    return mediaFailure('rejected', 'That reason is too long.');
  }

  try {
    const { data, error } = await client.rpc('report_content', {
      p_subject_kind: subjectKind,
      p_subject_ref: subjectRef,
      p_reason: trimmed.length > 0 ? trimmed : null,
    });

    if (error || typeof data !== 'string' || data.length === 0) {
      // NOT hidden. Stated. The caller must render this failure rather than
      // hiding the content anyway.
      return mediaFailure(
        'failed',
        'That report could not be sent, so the content has not been hidden. Try again.',
      );
    }

    return { ok: true, value: { reportId: data, hideForReporter: true } };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * The subjects this caller has reported, as `"kind:ref"` keys — the hide set.
 *
 * Fails CLOSED in the sense that matters here: on error the caller receives a
 * failure, never an empty set. An empty set silently UNHIDES everything the
 * user reported, which would show them the content they asked never to see
 * again and read as the report having been thrown away.
 */
export async function listReportedSubjects(
  client: SupabaseClient | null,
): Promise<MediaResult<Set<string>>> {
  if (client === null) return mediaUnavailable();

  try {
    // THROUGH THE RPC, NOT THE TABLE. `content_reports` is operator-only: 0066
    // carries no reporter SELECT policy and no grant to `authenticated`, because
    // V8-R-FEED-010 says the record is visible only to operators — a read-own
    // policy handed the reporter `reason` and `resolved_at`, i.e. operator
    // resolution state. `my_reported_subjects()` is the minimum this client is
    // entitled to: the two identifier columns needed to hide, and nothing else.
    const { data, error } = await client.rpc('my_reported_subjects');

    if (error) {
      return mediaFailure('failed', 'Your hidden content could not be loaded.');
    }

    const rows = (data ?? []) as { subject_kind: string; subject_ref: string }[];
    return {
      ok: true,
      value: new Set(rows.map((r) => reportKey(r.subject_kind, r.subject_ref))),
    };
  } catch {
    return mediaUnavailable();
  }
}

/** The key shape {@link listReportedSubjects} returns. One spelling, one place. */
export function reportKey(subjectKind: string, subjectRef: string): string {
  return `${subjectKind}:${subjectRef}`;
}
