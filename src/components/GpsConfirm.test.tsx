import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GpsConfirm from '@/components/GpsConfirm';
import type { Bar, Coords } from '@/types';

const seedBar: Bar = {
  id: 'x',
  name: 'The Seed Bar',
  neighborhood: 'LES',
  address: '1 Main St',
  lat: 40.72,
  lng: -73.99,
  priceTier: 2,
  tags: ['cocktail'],
  blurb: 'A bar.',
  lastVerified: '2026-04-01',
};

// Right at the seed bar → within GPS_CONFIRM_MILES.
const nearCoords: Coords = { lat: seedBar.lat, lng: seedBar.lng };
// ~3.5 miles north → well past GPS_CONFIRM_MILES.
const farCoords: Coords = { lat: seedBar.lat + 0.05, lng: seedBar.lng };

type Overrides = Partial<Parameters<typeof GpsConfirm>[0]>;

function renderGpsConfirm(overrides: Overrides = {}) {
  const onProceed = vi.fn();
  const onPickDifferent = vi.fn();
  const view = render(
    <GpsConfirm
      seedBar={seedBar}
      userCoords={null}
      accuracyBand="unknown"
      geoStatus="denied"
      onProceed={onProceed}
      onPickDifferent={onPickDifferent}
      {...overrides}
    />,
  );
  return { view, onProceed, onPickDifferent };
}

describe('GpsConfirm', () => {
  describe('while the geolocation request is in flight', () => {
    it('shows a locating spinner and no Continue button when requesting', () => {
      const { onProceed } = renderGpsConfirm({ geoStatus: 'requesting' });

      expect(screen.getByText('Locating you…')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(onProceed).not.toHaveBeenCalled();
    });

    it('treats idle as in-flight (parent requests right after mount)', () => {
      const { onProceed } = renderGpsConfirm({ geoStatus: 'idle' });

      expect(screen.getByText('Locating you…')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(onProceed).not.toHaveBeenCalled();
    });
  });

  describe('when the request resolved without a precise fix', () => {
    it('shows the no-fix prompt with Continue after denial', () => {
      const { onProceed } = renderGpsConfirm({ geoStatus: 'denied' });

      expect(
        screen.getByText(/We can’t confirm where you are/),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onProceed).toHaveBeenCalledTimes(1);
    });

    it('offers Pick a different bar as a back option', () => {
      const { onProceed, onPickDifferent } = renderGpsConfirm({
        geoStatus: 'unavailable',
      });

      fireEvent.click(
        screen.getByRole('button', { name: 'Pick a different bar' }),
      );
      expect(onPickDifferent).toHaveBeenCalledTimes(1);
      expect(onProceed).not.toHaveBeenCalled();
    });

    it('shows the no-fix prompt for a snapped (non-precise) fix', () => {
      renderGpsConfirm({
        geoStatus: 'granted_snapped',
        userCoords: nearCoords,
        accuracyBand: 'snapped',
      });

      expect(
        screen.getByText(/We can’t confirm where you are/),
      ).toBeInTheDocument();
    });
  });

  describe('when the request resolved with a precise fix', () => {
    it('auto-proceeds when the fix is near the seed bar', () => {
      const { onProceed } = renderGpsConfirm({
        geoStatus: 'granted_precise',
        userCoords: nearCoords,
        accuracyBand: 'precise',
      });

      expect(screen.getByText('Confirming location…')).toBeInTheDocument();
      expect(onProceed).toHaveBeenCalledTimes(1);
    });

    it('shows the mismatch prompt when the fix is far from the seed bar', () => {
      const { onProceed, onPickDifferent } = renderGpsConfirm({
        geoStatus: 'granted_precise',
        userCoords: farCoords,
        accuracyBand: 'precise',
      });

      expect(screen.getByText(/looks like you’re elsewhere/)).toBeInTheDocument();
      expect(onProceed).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole('button', { name: 'Pick a different bar' }),
      );
      expect(onPickDifferent).toHaveBeenCalledTimes(1);
    });

    it('proceeds on demand from the mismatch prompt', () => {
      const { onProceed } = renderGpsConfirm({
        geoStatus: 'granted_precise',
        userCoords: farCoords,
        accuracyBand: 'precise',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Proceed anyway' }));
      expect(onProceed).toHaveBeenCalledTimes(1);
    });
  });
});
