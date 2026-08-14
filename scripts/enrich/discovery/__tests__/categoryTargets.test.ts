import {
  CATEGORY_TARGETS,
  DISCOVERY_ALLOWED_SLUGS,
  matchByNameHint,
  resolveStructuralCategorySlug,
  targetedCategorySlugs,
} from '../categoryTargets';

// The live categories table (001_initial_schema.sql + 017_missing_categories.sql
// + 036_outdoor_sports_category.sql) — every slug this module can produce must
// exist here, or a discovery candidate would fail its category_id FK on insert.
const LIVE_CATEGORY_SLUGS = new Set([
  'soft-play', 'park', 'cafe', 'indoor-play', 'swimming', 'trampoline', 'farm',
  'bowling', 'arts', 'sports', 'library', 'sensory',
  'playground', 'childcare', 'museum', 'attraction', 'sports-activity',
  'animal-attraction', 'theme-park', 'outdoor-sports',
]);

describe('categoryTargets', () => {
  it('every target resolves to a category slug that actually exists in the DB', () => {
    for (const slug of targetedCategorySlugs()) {
      expect(LIVE_CATEGORY_SLUGS.has(slug)).toBe(true);
    }
  });

  it('every allowed discovery slug exists in the live categories table', () => {
    for (const slug of DISCOVERY_ALLOWED_SLUGS) {
      expect(LIVE_CATEGORY_SLUGS.has(slug)).toBe(true);
    }
  });

  it('covers at least 25 distinct target labels (spec asked for ~30)', () => {
    const labels = new Set(CATEGORY_TARGETS.map((t) => t.targetLabel));
    expect(labels.size).toBeGreaterThanOrEqual(25);
  });

  it('resolves a zoo via the production import pipeline mapping', () => {
    expect(resolveStructuralCategorySlug({ tourism: 'zoo' })).toBe('animal-attraction');
  });

  it('resolves a trampoline park', () => {
    expect(resolveStructuralCategorySlug({ leisure: 'trampoline_park' })).toBe('trampoline');
  });

  it('resolves a castle via historic= tag', () => {
    expect(resolveStructuralCategorySlug({ historic: 'castle' })).toBe('attraction');
  });

  it('remaps mini-golf to attraction (the DB has no mini-golf category)', () => {
    expect(resolveStructuralCategorySlug({ leisure: 'mini_golf' })).toBe('attraction');
  });

  it('drops family-restaurant entirely — out of this discovery pass scope', () => {
    expect(resolveStructuralCategorySlug({ amenity: 'cafe' })).toBeNull();
    expect(resolveStructuralCategorySlug({ amenity: 'restaurant' })).toBeNull();
  });

  it('returns null for an irrelevant POI (not blindly importing everything)', () => {
    expect(resolveStructuralCategorySlug({ amenity: 'fuel' })).toBeNull();
    expect(resolveStructuralCategorySlug({ tourism: 'hotel' })).toBeNull();
    expect(resolveStructuralCategorySlug({})).toBeNull();
  });

  it('matches a farm park by name hint fallback (no reliable OSM tag exists)', () => {
    const m = matchByNameHint('Sunnyvale Children\'s Farm');
    expect(m?.target.categorySlug).toBe('animal-attraction');
  });

  it('name-hint fallback returns null for unrelated names', () => {
    expect(matchByNameHint('Tesco Extra')).toBeNull();
  });
});
