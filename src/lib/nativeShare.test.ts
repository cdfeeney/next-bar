import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock('@capacitor/share', () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}));

import { attemptSystemShare } from './nativeShare';

describe('attemptSystemShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
  });

  it('preserves the browser Web Share path', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share,
    });

    await expect(
      attemptSystemShare({ text: 'Tonight', url: 'https://app.next-bar.com' }),
    ).resolves.toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('preserves browser dismissal without converting it to failure', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue({ name: 'AbortError' }),
    });

    await expect(attemptSystemShare({ text: 'Tonight' })).resolves.toBe(
      'dismissed',
    );
  });

  it('uses the Capacitor plugin in native builds', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.canShare.mockResolvedValue({ value: true });
    mocks.share.mockResolvedValue({ activityType: 'com.apple.UIKit.activity.Message' });

    await expect(attemptSystemShare({ text: 'Tonight' })).resolves.toBe(
      'shared',
    );
    expect(mocks.share).toHaveBeenCalledWith({ text: 'Tonight' });
  });

  it('fails closed on an ambiguous empty native activity result', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.canShare.mockResolvedValue({ value: true });
    mocks.share.mockResolvedValue({ activityType: '' });

    await expect(attemptSystemShare({ text: 'Tonight' })).resolves.toBe(
      'dismissed',
    );
  });

  it('reports unsupported native sharing without invoking the sheet', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.canShare.mockResolvedValue({ value: false });

    await expect(attemptSystemShare({ text: 'Tonight' })).resolves.toBe(
      'unavailable',
    );
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
