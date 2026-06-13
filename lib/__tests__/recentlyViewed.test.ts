/**
 * Tests for lib/recentlyViewed.ts — local "recently viewed" venue history.
 * Covers: first add, duplicate-moves-to-front, max length 10, persistence,
 * non-real-venue guard, and the pure helpers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addRecentlyViewed,
  getRecentlyViewed,
  removeDuplicates,
  keepMaximumTen,
  RECENTLY_VIEWED_KEY,
  type RecentlyViewedVenue,
} from '@/lib/recentlyViewed';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function v(id: string, over: Partial<RecentlyViewedVenue> = {}): RecentlyViewedVenue {
  return { id, name: `Venue ${id}`, review_count: 0, average_rating: 0, ...over };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('recentlyViewed', () => {
  it('adds the first venue', async () => {
    const list = await addRecentlyViewed(v('a'));
    expect(list.map((x) => x.id)).toEqual(['a']);
    expect(await getRecentlyViewed()).toHaveLength(1);
  });

  it('moves a re-viewed venue to the front with no duplicates', async () => {
    await addRecentlyViewed(v('a'));
    await addRecentlyViewed(v('b'));
    await addRecentlyViewed(v('a'));
    const list = await getRecentlyViewed();
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('caps at a maximum of 10, most-recent first', async () => {
    for (let i = 0; i < 13; i++) {
      await addRecentlyViewed(v(`id${i}`));
    }
    const list = await getRecentlyViewed();
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe('id12');
    expect(list.find((x) => x.id === 'id0')).toBeUndefined();
  });

  it('persists across reads (real fields kept, distance not stored)', async () => {
    await addRecentlyViewed({
      id: 'zoo',
      name: 'Chester Zoo',
      review_count: 5,
      average_rating: 4.6,
      // distance is intentionally NOT part of the stored shape
      category: { slug: 'farm' },
    });
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    expect(raw).toContain('Chester Zoo');

    const list = await getRecentlyViewed();
    expect(list[0].name).toBe('Chester Zoo');
    expect(list[0].average_rating).toBe(4.6);
    expect(list[0].category?.slug).toBe('farm');
    expect('distance_km' in list[0]).toBe(false);
  });

  it('ignores non-real venues (missing id/name)', async () => {
    await addRecentlyViewed({ id: '', name: 'No id' });
    await addRecentlyViewed(null);
    await addRecentlyViewed(undefined);
    expect(await getRecentlyViewed()).toHaveLength(0);
  });

  it('removeDuplicates keeps the first (front-most) occurrence', () => {
    expect(removeDuplicates([v('a'), v('b'), v('a')]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keepMaximumTen caps the length', () => {
    const many = Array.from({ length: 15 }, (_, i) => v(`id${i}`));
    expect(keepMaximumTen(many)).toHaveLength(10);
  });
});
