'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The ONE camera in the app. `next-bar-camera-modes.png` states it plainly —
 * "there is no second camera system" — so every capture surface (Share a
 * moment, Add to Story) mounts this hook rather than growing its own
 * getUserMedia call.
 *
 * Nothing is captured on entry: the stream is a preview until the shutter is
 * pressed, and the frame the shutter grabs is still a draft until it is
 * approved. That gate lives in the calling component; this hook only owns the
 * stream and the single-frame grab.
 *
 * Failure is a FIRST-CLASS state, not an exception: a browser with no camera,
 * a denied permission, and a device already using the camera all resolve to a
 * status the caller renders, because the library row is a working way out of
 * every one of them.
 */

export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'live'
  /** The user (or a policy) said no. */
  | 'denied'
  /** No device, no getUserMedia, or the device is busy. */
  | 'unavailable';

export type CameraFacing = 'environment' | 'user';

/**
 * WHY the camera is not live, where the platform says (V9-06). `status` stays
 * the two-way switch the stage renders on; `reason` picks the guidance.
 *
 * - `denied`     NotAllowedError / SecurityError / PermissionDeniedError — the
 *                user or a policy said no; the fix is in Settings.
 * - `no-api`     no `navigator.mediaDevices.getUserMedia` at all — an insecure
 *                context or a WebView without media capture.
 * - `no-device`  NotFoundError / DevicesNotFoundError / OverconstrainedError —
 *                nothing satisfies the request (no camera, or no lens facing
 *                that way).
 * - `busy`       NotReadableError / TrackStartError / AbortError — a camera
 *                exists but another app or tab holds it, or the OS refused to
 *                start it.
 * - `ended`      the live track ended under us (permission revoked mid-session,
 *                device claimed elsewhere).
 * - `unknown`    anything else — reported as unavailable with generic guidance.
 */
export type CameraFailure = 'denied' | 'no-api' | 'no-device' | 'busy' | 'ended' | 'unknown';

/** Map a getUserMedia rejection to the state the stage renders. Pure. */
export function classifyCameraError(name: string): { status: 'denied' | 'unavailable'; reason: CameraFailure } {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return { status: 'denied', reason: 'denied' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { status: 'unavailable', reason: 'no-device' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { status: 'unavailable', reason: 'busy' };
    default:
      return { status: 'unavailable', reason: 'unknown' };
  }
}

export type UseCamera = {
  status: CameraStatus;
  /** Why `status` is 'denied' or 'unavailable'; null while idle/starting/live. */
  reason: CameraFailure | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  /**
   * The lens the device ACTUALLY gave, read back off the live track, or null
   * when it will not say.
   *
   * `facingMode` in a constraint is a PREFERENCE, not a guarantee: a laptop or
   * a single-camera phone honours the request by handing back the only camera
   * it has. Without reading the track back, the dual shot labels its two steps
   * "rear" and "front" while both may be the same lens — the UI making a claim
   * about the hardware that the hardware never agreed to.
   */
  actualFacing: CameraFacing | null;
  /** A JPEG data URL of the current frame, or null if there is no frame. */
  capture: () => string | null;
  /** Re-request after a denial the user has since fixed. */
  retry: () => void;
};

/** JPEG quality for a story frame — visibly clean, well under a Mb. */
const CAPTURE_QUALITY = 0.85;

/**
 * Longest edge a stored frame may have. Stories live in `localStorage` as
 * data URLs, and a phone's library holds 12MP originals: one of those base64s
 * to several Mb, blows the quota, and `writeJson` swallows the failure — so
 * the post reads as shared and is gone on the next reload. Bounding the bytes
 * at the point they enter the app is what keeps that from being possible.
 */
const MAX_STORED_EDGE = 1440;

/** Scale (w,h) down so neither edge exceeds the bound. Never scales up. */
function boundedSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest === 0) return { width: 0, height: 0 };
  const scale = Math.min(1, MAX_STORED_EDGE / longest);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function useCamera(facing: CameraFacing, active: boolean): UseCamera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [reason, setReason] = useState<CameraFailure | null>(null);
  const [actualFacing, setActualFacing] = useState<CameraFacing | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    const onTrackEnded = (): void => {
      if (cancelled) return;
      setReason('ended');
      setStatus('unavailable');
    };
    setReason(null);
    setStatus('starting');

    void (async () => {
      const media = navigator.mediaDevices;
      if (media === undefined || typeof media.getUserMedia !== 'function') {
        if (cancelled) return;
        setReason('no-api');
        setStatus('unavailable');
        return;
      }
      try {
        stream = await media.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
      } catch (error) {
        if (cancelled) return;
        const failure = classifyCameraError(error instanceof Error ? error.name : '');
        setReason(failure.reason);
        setStatus(failure.status);
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (video !== null) {
        video.srcObject = stream;
        // A rejected play() is not a failure state: iOS resolves it on the
        // first user gesture and the preview catches up on its own.
        void video.play().catch(() => undefined);
      }
      // A stream can DIE while it is live — the permission is revoked in
      // browser settings, or another app claims the device. Without this the
      // status stays 'live' over a frozen last frame with the shutter armed,
      // which is the app lying about the camera; the track's own 'ended' event
      // is the only signal, and it fires once per track.
      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', onTrackEnded);
      });
      // What the device actually handed over. `getSettings().facingMode` is
      // absent on desktop and on some mobile browsers; absent means "will not
      // say", which is NOT the same as a mismatch and must not be reported as
      // one.
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      const served = settings?.facingMode;
      setActualFacing(
        served === 'environment' || served === 'user' ? served : null,
      );
      setStatus('live');
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => {
        track.removeEventListener('ended', onTrackEnded);
        track.stop();
      });
      const video = videoRef.current;
      if (video !== null) video.srcObject = null;
    };
  }, [facing, active, attempt]);

  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (video === null) return null;
    const { width, height } = boundedSize(video.videoWidth, video.videoHeight);
    if (width === 0 || height === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(video, 0, 0, width, height);
    try {
      return canvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
    } catch {
      // A tainted canvas cannot be read back; treat it as no frame rather
      // than letting the shutter throw into the render.
      return null;
    }
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, reason, videoRef, actualFacing, capture, retry };
}

/**
 * Rotate a data URL a quarter turn clockwise, returning a new data URL.
 * Baked at rotate time rather than carried as a transform, so every surface
 * that later renders the photo — viewer, feed card, receipt — sees the
 * orientation the poster approved.
 */
export async function rotateDataUrl(url: string): Promise<string> {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.height;
  canvas.height = image.width;
  const context = canvas.getContext('2d');
  if (context === null) return url;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(image, -image.width / 2, -image.height / 2);
  try {
    return canvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
  } catch {
    return url;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image decode failed'));
    image.src = url;
  });
}

/**
 * Read a picked file as a bounded data URL — the library row's one job.
 *
 * The picker's `accept="image/*"` is a hint to the file dialog, not a
 * guarantee about what arrives, so what was actually picked is checked here
 * and then DECODED: a file that is not an image fails to decode and never
 * reaches the flow. Re-encoding through the same bound the shutter uses is
 * what keeps a library original from being the one path that can overflow the
 * store.
 */
export async function fileToDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const raw = await readAsDataUrl(file);
  if (raw === null) return null;
  try {
    return await boundedJpeg(raw);
  } catch {
    // Not decodable as an image, whatever it claimed to be.
    return null;
  }
}

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Re-encode a data URL at or below MAX_STORED_EDGE. Throws if it will not
 * decode — and throws rather than returning the ORIGINAL if the re-encode
 * itself cannot be performed.
 *
 * THE FALLBACKS USED TO RETURN `url`. That is the raw FileReader result: the
 * library photo exactly as the camera wrote it, EXIF and GPS intact. The canvas
 * round-trip is the only thing in this build that strips that metadata — there
 * is no server-side re-encode — so a fallback that hands back the original
 * turns the one privacy control on this path into a best-effort suggestion, and
 * publishes a friend-visible photo carrying the coordinates it was taken at.
 * Failing closed loses a photo; failing open leaks a location.
 */
async function boundedJpeg(url: string): Promise<string> {
  const image = await loadImage(url);
  const { width, height } = boundedSize(image.width, image.height);
  if (width === 0 || height === 0) throw new Error('image has no dimensions');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context: cannot re-encode');
  context.drawImage(image, 0, 0, width, height);
  const encoded = canvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
  if (!encoded.startsWith('data:image/jpeg')) {
    // toDataURL falls back to image/png when the requested type is
    // unsupported, and returns "data:," on a tainted or zero-size canvas.
    // Neither is the re-encode this function promises.
    throw new Error('re-encode did not produce a JPEG');
  }
  return encoded;
}
