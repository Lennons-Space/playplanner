// Tests for the pure pilot-venue sampler (scripts/enrich/sampling.ts).
// No DB, no I/O — deterministic round-robin selection only.

import * as fs from 'fs';
import * as path from 'path';

import {
  stratifiedSample,
  categoryBreakdown,
  OUTING_CATEGORY_PRIORITY,
  parsePilotVenueIds,
  type Sampleable,
} from '../sampling';

/** Build N venues for a slug with stable, sortable ids: `${slug}-0001`, ... */
function make(slug: string | null, n: number, offset = 0): Sampleable[] {
  const label = slug ?? 'null';
  return Array.from({ length: n }, (_, i) => ({
    id: `${label}-${String(i + offset).padStart(4, '0')}`,
    slug,
  }));
}

const PRIORITY = ['soft-play', 'museum', 'park', 'trampoline'] as const;

describe('stratifiedSample', () => {
  describe('limits', () => {
    it('returns an empty array for limit <= 0', () => {
      const venues = make('museum', 10);
      expect(stratifiedSample(venues, { limit: 0, priority: PRIORITY })).toEqual([]);
      expect(stratifiedSample(venues, { limit: -5, priority: PRIORITY })).toEqual([]);
    });

    it('returns an empty array when there are no venues', () => {
      expect(stratifiedSample([], { limit: 50, priority: PRIORITY })).toEqual([]);
    });

    it('never returns more than the limit', () => {
      const venues = [...make('museum', 100), ...make('park', 100)];
      expect(stratifiedSample(venues, { limit: 30, priority: PRIORITY })).toHaveLength(30);
    });

    it('floors fractional limits', () => {
      const venues = make('museum', 10);
      expect(stratifiedSample(venues, { limit: 3.9, priority: PRIORITY })).toHaveLength(3);
    });

    it('returns every venue when limit exceeds the pool', () => {
      const venues = [...make('museum', 3), ...make('park', 2)];
      const out = stratifiedSample(venues, { limit: 50, priority: PRIORITY });
      expect(out).toHaveLength(5);
      expect(new Set(out.map((v) => v.id)).size).toBe(5);
    });
  });

  describe('balance (round-robin across categories)', () => {
    it('spreads the sample evenly when categories are plentiful', () => {
      const venues = [
        ...make('soft-play', 50),
        ...make('museum', 50),
        ...make('park', 50),
        ...make('trampoline', 50),
      ];
      const out = stratifiedSample(venues, { limit: 40, priority: PRIORITY });
      const counts = countBySlug(out);
      // 40 / 4 categories = 10 each.
      expect(counts).toEqual({ 'soft-play': 10, museum: 10, park: 10, trampoline: 10 });
    });

    it('does not let one large category dominate while others have venues', () => {
      const venues = [
        ...make('museum', 1000), // huge
        ...make('soft-play', 5),
        ...make('park', 5),
      ];
      const out = stratifiedSample(venues, { limit: 12, priority: PRIORITY });
      const counts = countBySlug(out);
      // 12 / 3 categories with >=4 each -> a perfectly even 4/4/4 spread; the
      // 1000-strong museum bucket gets no more than the small ones.
      expect(counts).toEqual({ museum: 4, 'soft-play': 4, park: 4 });
    });

    it('uses up small categories before over-drawing a large one', () => {
      const venues = [
        ...make('museum', 1000), // huge
        ...make('soft-play', 5),
        ...make('park', 5),
      ];
      const out = stratifiedSample(venues, { limit: 14, priority: PRIORITY });
      const counts = countBySlug(out);
      // soft-play + park (5 each) fully drawn; museum absorbs the remainder.
      expect(counts['soft-play']).toBe(5);
      expect(counts['park']).toBe(4); // park is 3rd in the round it runs dry
      expect(counts['museum']).toBe(5);
      expect(counts['soft-play'] + counts['park'] + counts['museum']).toBe(14);
    });
  });

  describe('sparse categories + fallback fill', () => {
    it('fills leftover slots from other priority categories when one is sparse', () => {
      const venues = [
        ...make('trampoline', 2), // sparse
        ...make('museum', 50),
        ...make('park', 50),
      ];
      const out = stratifiedSample(venues, { limit: 20, priority: PRIORITY });
      expect(out).toHaveLength(20);
      const counts = countBySlug(out);
      expect(counts['trampoline']).toBe(2); // all of the sparse category used
      // remaining 18 split across the two plentiful priority categories
      expect(counts['museum'] + counts['park']).toBe(18);
    });

    it('tops up from tier-2 filler only after priority categories are exhausted', () => {
      const venues = [
        ...make('museum', 3),
        ...make('park', 3),
        ...make('childcare', 100), // filler: not in PRIORITY
      ];
      const out = stratifiedSample(venues, { limit: 20, priority: PRIORITY });
      const counts = countBySlug(out);
      // All 6 priority venues used first; childcare only fills the rest.
      expect(counts['museum']).toBe(3);
      expect(counts['park']).toBe(3);
      expect(counts['childcare']).toBe(14);
      // The first 6 selected are the priority outings, not filler.
      expect(out.slice(0, 6).every((v) => v.slug !== 'childcare')).toBe(true);
    });

    it('excludes filler entirely when outing categories can satisfy the limit', () => {
      const venues = [
        ...make('museum', 50),
        ...make('park', 50),
        ...make('childcare', 500),
      ];
      const out = stratifiedSample(venues, { limit: 30, priority: PRIORITY });
      expect(countBySlug(out)['childcare']).toBeUndefined();
    });

    it('treats null-slug venues as filler and orders them last', () => {
      const venues = [...make('museum', 2), ...make(null, 100)];
      const out = stratifiedSample(venues, { limit: 5, priority: PRIORITY });
      const counts = countBySlug(out);
      expect(counts['museum']).toBe(2);
      expect(counts['null']).toBe(3);
      expect(out.slice(0, 2).every((v) => v.slug === 'museum')).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('collapses duplicate ids, keeping each venue once', () => {
      const dup = { id: 'museum-0001', slug: 'museum' };
      const venues = [dup, dup, { id: 'museum-0002', slug: 'museum' }, dup];
      const out = stratifiedSample(venues, { limit: 50, priority: PRIORITY });
      expect(out).toHaveLength(2);
      expect(out.map((v) => v.id).sort()).toEqual(['museum-0001', 'museum-0002']);
    });
  });

  describe('determinism', () => {
    it('produces identical output across repeated calls', () => {
      const venues = [
        ...make('museum', 17),
        ...make('park', 23),
        ...make('soft-play', 9),
        ...make('childcare', 40),
      ];
      const a = stratifiedSample(venues, { limit: 25, priority: PRIORITY });
      const b = stratifiedSample(venues, { limit: 25, priority: PRIORITY });
      expect(a.map((v) => v.id)).toEqual(b.map((v) => v.id));
    });

    it('is independent of input ordering (sorts by id within a bucket)', () => {
      const forward = [...make('museum', 5), ...make('park', 5)];
      const shuffled = [...forward].reverse();
      const a = stratifiedSample(forward, { limit: 6, priority: PRIORITY });
      const b = stratifiedSample(shuffled, { limit: 6, priority: PRIORITY });
      expect(a.map((v) => v.id)).toEqual(b.map((v) => v.id));
    });

    it('orders tier-1 buckets by the priority list, not alphabetically', () => {
      const venues = [...make('soft-play', 1), ...make('museum', 1), ...make('park', 1)];
      const out = stratifiedSample(venues, { limit: 3, priority: PRIORITY });
      // PRIORITY order is soft-play, museum, park (alpha would be museum, park, soft-play)
      expect(out.map((v) => v.slug)).toEqual(['soft-play', 'museum', 'park']);
    });
  });

  describe('default priority list', () => {
    it('uses OUTING_CATEGORY_PRIORITY when none is supplied and de-prioritises childcare', () => {
      const venues = [
        ...make('soft-play', 2),
        ...make('museum', 2),
        ...make('childcare', 50),
      ];
      const out = stratifiedSample(venues, { limit: 4 });
      // childcare is not in OUTING_CATEGORY_PRIORITY -> filler, excluded here.
      expect(countBySlug(out)['childcare']).toBeUndefined();
      expect(out).toHaveLength(4);
    });

    it('OUTING_CATEGORY_PRIORITY contains the real outing slugs and excludes childcare', () => {
      expect(OUTING_CATEGORY_PRIORITY).toContain('museum');
      expect(OUTING_CATEGORY_PRIORITY).toContain('soft-play');
      expect(OUTING_CATEGORY_PRIORITY).not.toContain('childcare');
    });
  });
});

describe('categoryBreakdown', () => {
  it('counts per slug and sorts by count desc then slug asc', () => {
    const selected = [
      ...make('museum', 3),
      ...make('park', 3),
      ...make('soft-play', 1),
    ];
    expect(categoryBreakdown(selected)).toEqual([
      { slug: 'museum', count: 3 },
      { slug: 'park', count: 3 },
      { slug: 'soft-play', count: 1 },
    ]);
  });

  it('labels null slugs as (none)', () => {
    expect(categoryBreakdown(make(null, 2))).toEqual([{ slug: '(none)', count: 2 }]);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function countBySlug(venues: readonly Sampleable[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of venues) {
    const key = v.slug ?? 'null';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// =============================================================================
// parsePilotVenueIds — the pilot_venue_ids.json override parser
// =============================================================================
const ID_A = '0f81079d-3b6d-4ad8-8e88-57acac17aafd';
const ID_B = '02b458e6-456c-4f2c-96a9-5547f92d48e3';

describe('parsePilotVenueIds', () => {
  it('accepts a valid JSON array of UUIDs and trims/dedups', () => {
    const r = parsePilotVenueIds(`[" ${ID_A} ", "${ID_B}", "${ID_A}"]`);
    expect(r).toEqual({ ok: true, ids: [ID_A, ID_B] }); // trimmed + deduped, order kept
  });

  it('rejects invalid JSON', () => {
    expect(parsePilotVenueIds('not json').ok).toBe(false);
    expect(parsePilotVenueIds('{ bad').ok).toBe(false);
  });

  it('rejects a non-array', () => {
    expect(parsePilotVenueIds(`{"ids":["${ID_A}"]}`).ok).toBe(false);
    expect(parsePilotVenueIds(`"${ID_A}"`).ok).toBe(false);
  });

  it('rejects an empty array', () => {
    const r = parsePilotVenueIds('[]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it('rejects a non-string or non-UUID entry and reports its index', () => {
    const bad = parsePilotVenueIds(`["${ID_A}", 42]`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/entry 1/);
    expect(parsePilotVenueIds(`["${ID_A}", "not-a-uuid"]`).ok).toBe(false);
  });

  it('the real scripts/enrich/pilot_venue_ids.json is valid and holds exactly the 5 verified IDs', () => {
    const file = path.join(__dirname, '..', 'pilot_venue_ids.json');
    const r = parsePilotVenueIds(fs.readFileSync(file, 'utf8'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ids).toHaveLength(5);
      expect(r.ids).toEqual([
        '0f81079d-3b6d-4ad8-8e88-57acac17aafd',
        '02b458e6-456c-4f2c-96a9-5547f92d48e3',
        '056402c7-6349-431a-8ca8-5909d97fbae5',
        '0074d23b-3d41-49af-a7ed-a819d9234806',
        '06bd1910-fe23-48ff-be38-268b0bbfb619',
      ]);
    }
  });
});
