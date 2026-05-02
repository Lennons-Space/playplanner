// Pure utility layer for Wikimedia Commons image search and parsing.
// No network calls here — all functions accept pre-fetched API response
// objects so they are fully testable without mocking fetch.

// ── License classification ─────────────────────────────────────────────────

/**
 * Returns true when a Wikimedia LicenseShortName string is a usable open
 * licence for the app: CC0, public domain, CC BY (any version), CC BY-SA
 * (any version).
 *
 * Rejects NC (non-commercial), ND (no-derivatives), and unknown/proprietary
 * licences. These are too restrictive for a commercial family app.
 */
export function isUsableLicense(shortName: string): boolean {
  if (!shortName) return false;
  const lc = shortName.toLowerCase().trim();

  // Public domain and CC0 — no restrictions at all.
  if (lc === 'public domain' || lc.startsWith('cc0') || lc.startsWith('pdm')) return true;

  // Must be a Creative Commons licence.
  if (!lc.startsWith('cc')) return false;

  // Reject non-commercial and no-derivatives variants.
  if (lc.includes('-nc') || lc.includes(' nc') || lc.includes('noncommercial')) return false;
  if (lc.includes('-nd') || lc.includes(' nd') || lc.includes('noderivative'))  return false;

  // Accept CC BY and CC BY-SA in any version.
  if (lc.includes('by')) return true;

  return false;
}

// ── Attribution string builder ─────────────────────────────────────────────

/**
 * Strips HTML tags from a Wikimedia Artist or description field.
 * Wikimedia often wraps author names in <a> or <span> tags.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the required attribution string from Wikimedia metadata.
 * Format: "Author / License / Wikimedia Commons"
 *
 * CC licences require crediting the author and naming the licence.
 * Appending "/ Wikimedia Commons" makes the source clear to users.
 */
export function buildAttribution(artist: string, licenseShortName: string): string {
  const cleanArtist  = stripHtml(artist).replace(/^by\s+/i, '').trim() || 'Unknown';
  const cleanLicense = licenseShortName.trim() || 'Unknown license';
  return `${cleanArtist} / ${cleanLicense} / Wikimedia Commons`;
}

// ── Wikimedia API response types ───────────────────────────────────────────

export interface WikimediaExtMetadata {
  value: string;
  source?: string;
  hidden?: string;
}

export interface WikimediaImageInfo {
  url:          string;
  thumburl?:    string;
  extmetadata?: {
    LicenseShortName?: WikimediaExtMetadata;
    Artist?:           WikimediaExtMetadata;
    ImageDescription?: WikimediaExtMetadata;
  };
}

export interface WikimediaPage {
  title:      string;
  missing?:   string;
  imageinfo?: WikimediaImageInfo[];
}

export interface WikimediaImageInfoResponse {
  query?: {
    pages?: Record<string, WikimediaPage>;
  };
}

export interface WikimediaSearchResult {
  title: string;
}

export interface WikimediaSearchResponse {
  query?: {
    search?: WikimediaSearchResult[];
  };
}

// ── Image info extraction ──────────────────────────────────────────────────

export interface ExtractedImage {
  /** Full-resolution or 800px-wide thumbnail URL from Wikimedia CDN. */
  url:         string;
  /** Short licence string, e.g. "CC BY-SA 4.0". */
  license:     string;
  /** Pre-built attribution string ready to display. */
  attribution: string;
}

/**
 * Extracts a usable image from a Wikimedia imageinfo API response.
 * Returns null when:
 *   - page is missing or has no imageinfo
 *   - extmetadata is absent (no licence data to verify)
 *   - the licence is not in the CC0/CC-BY/CC-BY-SA set
 */
export function extractImageInfo(
  response: WikimediaImageInfoResponse,
): ExtractedImage | null {
  const pages = response?.query?.pages;
  if (!pages) return null;

  // The pages object is keyed by page ID (may be "-1" for missing pages).
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;

  const info = page.imageinfo?.[0];
  if (!info) return null;

  const meta = info.extmetadata;
  if (!meta) return null;

  const licenseShortName = meta.LicenseShortName?.value ?? '';
  if (!isUsableLicense(licenseShortName)) return null;

  // Prefer the 800px thumbnail; fall back to full-res URL.
  const url = info.thumburl ?? info.url;
  if (!url) return null;

  const artist      = meta.Artist?.value ?? '';
  const attribution = buildAttribution(artist, licenseShortName);

  return { url, license: licenseShortName, attribution };
}

/**
 * Parses a Wikimedia Commons search response and returns the titles of
 * matched File: pages for further imageinfo lookup.
 */
export function extractSearchTitles(response: WikimediaSearchResponse): string[] {
  return (response?.query?.search ?? []).map((r) => r.title);
}

// ── Category fallback search terms ────────────────────────────────────────
// Used by the enrichment script when no exact venue match is found.
// Each term is designed to find representative, child-safe images on
// Wikimedia Commons. Terms use common English descriptions likely to
// appear in Wikimedia file names and descriptions.

export const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  'soft-play':       'soft play area children indoor UK',
  'park':            'children playground park UK',
  'cafe':            'family cafe interior',
  'indoor-play':     'children indoor play centre',
  'swimming':        'children swimming pool leisure centre',
  'trampoline':      'trampoline park indoor',
  'farm':            'children farm visit animals',
  'bowling':         'bowling alley family',
  'arts':            'children art craft workshop',
  'sports':          'children sports hall indoor',
  'library':         'children library reading',
  'sensory':         'sensory play room children',
  'outdoor-sports':  'outdoor sports children park',
};

/**
 * Returns the Wikimedia search term for a category slug, falling back
 * to a generic family activity search for unknown slugs.
 */
export function getCategorySearchTerm(slug: string | null | undefined): string {
  if (!slug) return 'children family activity UK';
  return CATEGORY_SEARCH_TERMS[slug] ?? 'children family activity UK';
}
