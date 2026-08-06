import type { AccountContentKey } from '@/lib/accountContent.local';

/** Human names for the four account-content domains — every dialog that
 *  names content for a discard/keep decision uses these. */
export const ACCOUNT_CONTENT_LABELS: Record<AccountContentKey, string> = {
  lists: 'Saved lists',
  night_log: "Tonight's log",
  night_archive: 'Night history',
  shared_nights: 'Shared-night links',
};
