import { resolveVenueCategory, buildCategoryLookup } from '../resolveVenueCategory';
import type { Venue } from '@/types';

// Minimal venue stub — only the fields the resolver reads.
function v(over: Partial<Venue>): Pick<Venue, 'category' | 'category_id'> {
  return { category: undefined, category_id: null, ...over } as Pick<Venue, 'category' | 'category_id'>;
}

const PARK = { id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A' };

describe('resolveVenueCategory', () => {
  it('resolves a flat category_id via the categories lookup (get_nearby_venues RPC shape)', () => {
    // This is the Waterway Park case: the RPC returns only category_id.
    const lookup = buildCategoryLookup([PARK]);
    const result = resolveVenueCategory(v({ category_id: 'cat-park' }), lookup);
    expect(result).toEqual({
      id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A',
    });
  });

  it('passes through an already-joined nested category object (useVenue shape)', () => {
    const joined = { id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A' };
    const result = resolveVenueCategory(v({ category: joined as Venue['category'] }));
    expect(result?.name).toBe('Park & Playground');
  });

  it('handles the PostgREST array-join shape (category: [ {...} ])', () => {
    const arr = [{ id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A' }];
    // Cast through unknown — some join configs return an array at runtime.
    const result = resolveVenueCategory(v({ category: arr as unknown as Venue['category'] }));
    expect(result?.name).toBe('Park & Playground');
  });

  it('returns null when the category is genuinely absent (no object, no matching id)', () => {
    expect(resolveVenueCategory(v({}), buildCategoryLookup([PARK]))).toBeNull();
    // category_id present but not in the lookup → still null (never fabricate).
    expect(resolveVenueCategory(v({ category_id: 'unknown-id' }), buildCategoryLookup([PARK]))).toBeNull();
  });

  it('prefers a real joined object over the id lookup', () => {
    const joined = { id: 'cat-x', name: 'Museum', slug: 'museum', icon: '🏛️', color: '#B85BE8' };
    const result = resolveVenueCategory(
      v({ category: joined as Venue['category'], category_id: 'cat-park' }),
      buildCategoryLookup([PARK]),
    );
    expect(result?.name).toBe('Museum');
  });

  it('buildCategoryLookup tolerates null/undefined input', () => {
    expect(buildCategoryLookup(undefined).size).toBe(0);
    expect(buildCategoryLookup(null).size).toBe(0);
  });
});
