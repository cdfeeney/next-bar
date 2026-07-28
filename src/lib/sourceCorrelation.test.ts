import { describe, expect, it } from 'vitest';
import type { WeeklyHours } from '@/types';
import { assessSiteCandidate, googleProvenanceMarker } from './sourceCorrelation';

const HOURS: WeeklyHours = {
  5: [{ open: '17:00', close: '02:00' }],
  6: [{ open: '17:00', close: '03:00' }],
};
const OTHER_HOURS: WeeklyHours = {
  5: [{ open: '16:00', close: '01:00' }],
};

const PLAIN = '<html><body><h2>Hours</h2><p>Fri 5pm-2am</p></body></html>';

describe('googleProvenanceMarker', () => {
  it.each([
    ['<iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe>', 'embed iframe'],
    ['<script src="https://maps.googleapis.com/maps/api/js?key=x"></script>', 'JS/API'],
    ['<div data-google-place="ChIJabc"></div>', 'Places widget'],
    ['<span>place_id: "ChIJI25hF09ZwokRnmmiXXONRf4"</span>', 'place_id'],
    ['<footer>Hours powered by Google</footer>', 'powered by Google'],
  ])('flags %s', (html) => {
    expect(googleProvenanceMarker(html)).not.toBeNull();
  });

  it('does not flag an ordinary page', () => {
    expect(googleProvenanceMarker(PLAIN)).toBeNull();
  });

  it('does not flag a plain link to Google Maps directions', () => {
    // A "find us" link is not a data source; only embedded WIDGETS are.
    const html = '<a href="https://www.google.com/maps/search/?api=1&query=Attaboy">Directions</a>';
    expect(googleProvenanceMarker(html)).toBeNull();
  });
});

describe('assessSiteCandidate', () => {
  it('REJECTS a page whose hours come from a Google widget', () => {
    const v = assessSiteCandidate({
      html: '<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>',
      siteHours: HOURS,
      osmHours: OTHER_HOURS,
    });
    expect(v.verdict).toBe('reject');
    // Persisting this would be the compliance breach, not just weak evidence.
    expect(v.verdict === 'reject' && v.reason).toMatch(/Google-derived/);
  });

  it('marks hours identical to OSM as correlated, not independent', () => {
    const v = assessSiteCandidate({ html: PLAIN, siteHours: HOURS, osmHours: HOURS });
    expect(v.verdict).toBe('correlated');
  });

  it('treats a site that DISAGREES with OSM as independent', () => {
    const v = assessSiteCandidate({ html: PLAIN, siteHours: HOURS, osmHours: OTHER_HOURS });
    expect(v).toEqual({ verdict: 'independent' });
  });

  it('treats a site as independent when the venue has no OSM hours to compare', () => {
    const v = assessSiteCandidate({ html: PLAIN, siteHours: HOURS });
    expect(v).toEqual({ verdict: 'independent' });
  });

  it('rejects on Google provenance even when the hours differ from OSM', () => {
    // Compliance outranks corroboration: a Google-sourced value is unusable
    // regardless of how much independent signal it appears to add.
    const v = assessSiteCandidate({
      html: '<script src="https://maps.googleapis.com/maps/api/js"></script>',
      siteHours: HOURS,
      osmHours: OTHER_HOURS,
    });
    expect(v.verdict).toBe('reject');
  });
});
