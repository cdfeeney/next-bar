import { Capacitor } from '@capacitor/core';
import { Share, type ShareOptions } from '@capacitor/share';
import { isShareAbort } from './share';

export type SystemShareOptions = Pick<ShareOptions, 'title' | 'text' | 'url'>;

export type SystemShareOutcome =
  | 'shared'
  | 'dismissed'
  | 'unavailable'
  | 'failed';

/**
 * One privacy-preserving share boundary for browser/PWA and native iOS.
 *
 * Capacitor documents that activityType may be empty. On the iOS-first path
 * we treat an empty result as dismissal: under-counting is safer than touching
 * the clipboard or claiming success after a user backed out.
 */
export async function attemptSystemShare(
  options: SystemShareOptions,
): Promise<SystemShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    try {
      const capability = await Share.canShare();
      if (!capability.value) return 'unavailable';
      const result = await Share.share(options);
      return result.activityType?.trim() ? 'shared' : 'dismissed';
    } catch (error) {
      return isShareAbort(error) ? 'dismissed' : 'failed';
    }
  }

  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unavailable';
  }

  try {
    await navigator.share(options);
    return 'shared';
  } catch (error) {
    return isShareAbort(error) ? 'dismissed' : 'failed';
  }
}
