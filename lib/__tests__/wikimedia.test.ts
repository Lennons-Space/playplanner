import {
  isUsableLicense,
  stripHtml,
  buildAttribution,
  extractImageInfo,
  extractSearchTitles,
  getCategorySearchTerm,
  CATEGORY_SEARCH_TERMS,
  type WikimediaImageInfoResponse,
  type WikimediaSearchResponse,
} from '../wikimedia';

// ── isUsableLicense ────────────────────────────────────────────────────────

describe('isUsableLicense', () => {
  // Accepted
  it('accepts CC0', () => {
    expect(isUsableLicense('CC0')).toBe(true);
    expect(isUsableLicense('CC0 1.0')).toBe(true);
  });

  it('accepts public domain', () => {
    expect(isUsableLicense('Public domain')).toBe(true);
    expect(isUsableLicense('public domain')).toBe(true);
  });

  it('accepts PDM', () => {
    expect(isUsableLicense('PDM 1.0')).toBe(true);
  });

  it('accepts CC BY variants', () => {
    expect(isUsableLicense('CC BY 4.0')).toBe(true);
    expect(isUsableLicense('CC BY 3.0')).toBe(true);
    expect(isUsableLicense('CC BY 2.0')).toBe(true);
    expect(isUsableLicense('CC-BY-4.0')).toBe(true);
  });

  it('accepts CC BY-SA variants', () => {
    expect(isUsableLicense('CC BY-SA 4.0')).toBe(true);
    expect(isUsableLicense('CC BY-SA 3.0')).toBe(true);
    expect(isUsableLicense('CC-BY-SA-4.0')).toBe(true);
  });

  // Rejected
  it('rejects CC BY-NC (non-commercial)', () => {
    expect(isUsableLicense('CC BY-NC 4.0')).toBe(false);
    expect(isUsableLicense('CC-BY-NC-4.0')).toBe(false);
  });

  it('rejects CC BY-ND (no derivatives)', () => {
    expect(isUsableLicense('CC BY-ND 4.0')).toBe(false);
    expect(isUsableLicense('CC-BY-ND-4.0')).toBe(false);
  });

  it('rejects CC BY-NC-SA', () => {
    expect(isUsableLicense('CC BY-NC-SA 4.0')).toBe(false);
  });

  it('rejects CC BY-NC-ND', () => {
    expect(isUsableLicense('CC BY-NC-ND 4.0')).toBe(false);
  });

  it('rejects unknown / proprietary strings', () => {
    expect(isUsableLicense('All rights reserved')).toBe(false);
    expect(isUsableLicense('Copyrighted')).toBe(false);
    expect(isUsableLicense('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isUsableLicense('cc by 4.0')).toBe(true);
    expect(isUsableLicense('CC BY-NC 4.0')).toBe(false);
    expect(isUsableLicense('CC0')).toBe(true);
  });
});

// ── stripHtml ──────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('strips anchor tags', () => {
    expect(stripHtml('<a href="...">John Smith</a>')).toBe('John Smith');
  });

  it('strips span and nested tags', () => {
    expect(stripHtml('<span class="x"><b>Jane</b> Doe</span>')).toBe('Jane Doe');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtml('Jane Doe')).toBe('Jane Doe');
  });

  it('collapses extra whitespace', () => {
    expect(stripHtml('  John   Smith  ')).toBe('John Smith');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});

// ── buildAttribution ───────────────────────────────────────────────────────

describe('buildAttribution', () => {
  it('builds standard attribution string', () => {
    expect(buildAttribution('John Smith', 'CC BY-SA 4.0'))
      .toBe('John Smith / CC BY-SA 4.0 / Wikimedia Commons');
  });

  it('strips leading "by " from artist field', () => {
    expect(buildAttribution('by Jane Doe', 'CC BY 4.0'))
      .toBe('Jane Doe / CC BY 4.0 / Wikimedia Commons');
  });

  it('strips HTML from artist field', () => {
    expect(buildAttribution('<a href="#">Photo by Alice</a>', 'CC0'))
      .toContain('Wikimedia Commons');
    expect(buildAttribution('<a href="#">Photo by Alice</a>', 'CC0'))
      .not.toContain('<a');
  });

  it('uses "Unknown" when artist is empty', () => {
    expect(buildAttribution('', 'CC BY 4.0'))
      .toBe('Unknown / CC BY 4.0 / Wikimedia Commons');
  });

  it('uses "Unknown license" when license is empty', () => {
    expect(buildAttribution('Alice', ''))
      .toBe('Alice / Unknown license / Wikimedia Commons');
  });
});

// ── extractImageInfo ───────────────────────────────────────────────────────

describe('extractImageInfo', () => {
  function makeResponse(overrides: {
    missing?: string;
    licenseShortName?: string;
    url?: string;
    thumburl?: string;
    artist?: string;
    noExtmetadata?: boolean;
    noImageinfo?: boolean;
  } = {}): WikimediaImageInfoResponse {
    const page: Record<string, unknown> = {
      title: 'File:Test_image.jpg',
    };

    if (overrides.missing !== undefined) {
      page.missing = overrides.missing;
    } else if (overrides.noImageinfo) {
      page.imageinfo = undefined;
    } else {
      const info: Record<string, unknown> = {
        url: overrides.url ?? 'https://upload.wikimedia.org/wikipedia/commons/test.jpg',
      };
      if (overrides.thumburl) info.thumburl = overrides.thumburl;
      if (!overrides.noExtmetadata) {
        info.extmetadata = {
          ...(overrides.licenseShortName !== undefined && {
            LicenseShortName: { value: overrides.licenseShortName },
          }),
          ...(overrides.artist !== undefined && {
            Artist: { value: overrides.artist },
          }),
        };
      }
      page.imageinfo = [info];
    }

    return { query: { pages: { '12345': page as never } } };
  }

  it('returns null for empty response', () => {
    expect(extractImageInfo({})).toBeNull();
    expect(extractImageInfo({ query: {} })).toBeNull();
    expect(extractImageInfo({ query: { pages: {} } })).toBeNull();
  });

  it('returns null for missing page', () => {
    expect(extractImageInfo(makeResponse({ missing: '' }))).toBeNull();
  });

  it('returns null when imageinfo is absent', () => {
    expect(extractImageInfo(makeResponse({ noImageinfo: true }))).toBeNull();
  });

  it('returns null when extmetadata is absent', () => {
    expect(extractImageInfo(makeResponse({ noExtmetadata: true }))).toBeNull();
  });

  it('returns null for missing LicenseShortName', () => {
    const resp = makeResponse({});
    // extmetadata exists but no LicenseShortName key
    (resp.query!.pages!['12345'].imageinfo![0].extmetadata as Record<string, unknown>).LicenseShortName = undefined;
    expect(extractImageInfo(resp)).toBeNull();
  });

  it('returns null for unusable licence (NC)', () => {
    expect(extractImageInfo(makeResponse({ licenseShortName: 'CC BY-NC 4.0' }))).toBeNull();
  });

  it('returns extracted image for CC BY-SA', () => {
    const result = extractImageInfo(makeResponse({
      licenseShortName: 'CC BY-SA 4.0',
      artist: 'Alice Photographer',
    }));
    expect(result).not.toBeNull();
    expect(result!.license).toBe('CC BY-SA 4.0');
    expect(result!.attribution).toContain('Alice Photographer');
    expect(result!.attribution).toContain('Wikimedia Commons');
  });

  it('prefers thumburl over url', () => {
    const result = extractImageInfo(makeResponse({
      licenseShortName: 'CC0',
      url:      'https://upload.wikimedia.org/full.jpg',
      thumburl: 'https://upload.wikimedia.org/thumb/t/t/thumb.jpg/800px-thumb.jpg',
    }));
    expect(result!.url).toContain('800px');
  });

  it('returns CC0 image without artist', () => {
    const result = extractImageInfo(makeResponse({ licenseShortName: 'CC0' }));
    expect(result).not.toBeNull();
    expect(result!.attribution).toContain('Unknown');
    expect(result!.attribution).toContain('CC0');
  });
});

// ── extractSearchTitles ────────────────────────────────────────────────────

describe('extractSearchTitles', () => {
  it('returns empty array for empty response', () => {
    expect(extractSearchTitles({})).toEqual([]);
    expect(extractSearchTitles({ query: {} })).toEqual([]);
    expect(extractSearchTitles({ query: { search: [] } })).toEqual([]);
  });

  it('extracts titles from search results', () => {
    const response: WikimediaSearchResponse = {
      query: {
        search: [
          { title: 'File:Soft_play_1.jpg' },
          { title: 'File:Indoor_play.jpg' },
        ],
      },
    };
    expect(extractSearchTitles(response)).toEqual([
      'File:Soft_play_1.jpg',
      'File:Indoor_play.jpg',
    ]);
  });
});

// ── getCategorySearchTerm ──────────────────────────────────────────────────

describe('getCategorySearchTerm', () => {
  it('returns a term for every known category slug', () => {
    for (const slug of Object.keys(CATEGORY_SEARCH_TERMS)) {
      const term = getCategorySearchTerm(slug);
      expect(typeof term).toBe('string');
      expect(term.length).toBeGreaterThan(0);
    }
  });

  it('returns a generic fallback for unknown slug', () => {
    expect(getCategorySearchTerm('unknown-category')).toContain('children');
  });

  it('returns a generic fallback for null/undefined', () => {
    expect(getCategorySearchTerm(null)).toContain('children');
    expect(getCategorySearchTerm(undefined)).toContain('children');
  });

  it('covers all 13 known category slugs', () => {
    const expectedSlugs = [
      'soft-play', 'park', 'cafe', 'indoor-play', 'swimming',
      'trampoline', 'farm', 'bowling', 'arts', 'sports',
      'library', 'sensory', 'outdoor-sports',
    ];
    for (const slug of expectedSlugs) {
      expect(CATEGORY_SEARCH_TERMS).toHaveProperty(slug);
    }
  });
});
