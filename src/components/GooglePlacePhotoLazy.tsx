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
});
