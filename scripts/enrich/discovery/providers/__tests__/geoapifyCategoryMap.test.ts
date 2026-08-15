import { allMappedGeoapifyCategories, GEOAPIFY_CATEGORY_MAP, resolveGeoapifyCategorySlug } from '../geoapifyCategoryMap';

describe('geoapifyCategoryMap', () => {
  it('maps zoo to animal-attraction', () => {
    expect(resolveGeoapifyCategorySlug(['entertainment.zoo'])).toBe('animal-attraction');
  });

  it('returns null for an unmapped category', () => {
    expect(resolveGeoapifyCategorySlug(['commercial.supermarket'])).toBeNull();
  });

  it('returns null for an empty category list', () => {
    expect(resolveGeoapifyCategorySlug([])).toBeNull();
  });

  it('picks the first mapped category when several are present', () => {
    expect(resolveGeoapifyCategorySlug(['commercial.supermarket', 'leisure.playground'])).toBe('playground');
  });

  it('allMappedGeoapifyCategories returns every key in the map', () => {
    expect(allMappedGeoapifyCategories().sort()).toEqual(Object.keys(GEOAPIFY_CATEGORY_MAP).sort());
  });
});
