'use client';

import dynamic from 'next/dynamic';

/**
 * The ONLY way surfaces may import the compliant Google photo widget.
 *
 * `ssr: false` + dynamic import keeps the Maps SDK seam (placesUiKit) out of
 * every bundle that does not render this component — so an excluded surface
 * (criterion 12: pickers, saved lists, recaps, dense maps, markers) cannot
 * bill even by accident: the billable code is simply not on its client.
 */
export default dynamic(() => import('@/components/GooglePlacePhoto'), {
  ssr: false,
  /**
   * Reserve the 21/9 strip from FIRST PAINT, not from mount.
   *
   * Without this the media band is 0px tall until the dynamic chunk
   * resolves, then snaps to the reservation when GooglePlacePhoto mounts
   * with status='pending' — so the layout jump criterion 4 forbids still
   * happened once per cold load, upstream of the component that reserves
   * the space. The e2e delayed scenario cannot see it either: it only starts
   * sampling once `data-status="pending"` exists, i.e. after the gap has
   * already closed. (santa: Claude/FABLE M2.)
   *
   * Purely a placeholder box — it renders no Google content and issues no
   * request, so it cannot affect billing.
   */
  loading: () => <div className="w-full aspect-[21/9]" />,
});
