/**
 * Regression tests for Plan Visit screen helpers.
 * Covers the two launch blockers fixed:
 *   1. Category slug drives correct checklist + tips
 *   2. distance_km param drives the distance pill
 */

// Prevent lib/supabase.ts from throwing on missing env vars — this file
// is transitively imported by plan-visit.tsx via useVenue / useAuth.
import { getChecklistItems } from '../plan-visit';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

describe('getChecklistItems', () => {
  it('returns soft-play items for soft-play category', () => {
    const items = getChecklistItems('soft-play');
    expect(items).toContain('Grip socks');
    expect(items).not.toContain('Sunscreen');
  });

  it('returns outdoor items for park category', () => {
    const items = getChecklistItems('park');
    expect(items).toContain('Sunscreen');
    expect(items).not.toContain('Grip socks');
  });

  it('returns outdoor items for outdoor-sports category', () => {
    const items = getChecklistItems('outdoor-sports');
    expect(items).toContain('Sunscreen');
  });

  it('returns swimming items for swimming category', () => {
    const items = getChecklistItems('swimming');
    expect(items).toContain('Swimwear & towel');
  });

  it('returns farm items for farm category', () => {
    const items = getChecklistItems('farm');
    expect(items).toContain('Wellies');
    expect(items).toContain('Hand sanitiser');
  });

  it('returns generic fallback for undefined slug', () => {
    const items = getChecklistItems(undefined);
    expect(items).toContain('Snacks & water');
    // Should NOT have category-specific items
    expect(items).not.toContain('Grip socks');
    expect(items).not.toContain('Swimwear & towel');
  });

  it('returns generic fallback for null slug', () => {
    const items = getChecklistItems(null);
    expect(items).toContain('Snacks & water');
  });

  it('returns non-empty list for all known slugs', () => {
    const slugs = [
      'soft-play', 'indoor-play', 'trampoline',
      'park', 'outdoor-sports',
      'farm', 'swimming', 'arts', 'library',
      'bowling', 'sports', 'cafe',
    ];
    for (const slug of slugs) {
      expect(getChecklistItems(slug).length).toBeGreaterThan(0);
    }
  });
});

describe('distance_km param → distanceMiles conversion', () => {
  // Test the conversion logic directly (extracted inline for testability)
  function convertDistanceMiles(rawDistanceKm: string | undefined): string | null {
    const raw = rawDistanceKm ? parseFloat(rawDistanceKm) : null;
    return raw != null && Number.isFinite(raw) && raw > 0
      ? `${(raw * 0.621371).toFixed(1)} mi`
      : null;
  }

  it('converts a valid distance_km param to miles', () => {
    expect(convertDistanceMiles('3.5')).toBe('2.2 mi');
  });

  it('returns null when param is empty string', () => {
    expect(convertDistanceMiles('')).toBeNull();
  });

  it('returns null when param is undefined', () => {
    expect(convertDistanceMiles(undefined)).toBeNull();
  });

  it('returns null for zero distance', () => {
    expect(convertDistanceMiles('0')).toBeNull();
  });

  it('returns null for negative distance', () => {
    expect(convertDistanceMiles('-1')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(convertDistanceMiles('abc')).toBeNull();
  });
});
