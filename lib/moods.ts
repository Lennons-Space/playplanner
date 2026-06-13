// ─────────────────────────────────────────────────────────────────────────
// Kids' mood discovery options for the Home screen ("What are the kids in the
// mood for?").
//
// LOCAL UI ONLY (2026-06-13): mood selection is presentational — a single-select
// chip state held by the Home screen. It does NOT change Supabase queries or the
// recommendation ranking (Home polish TASK 6 forbids that). MOOD_CATEGORY_MAP
// maps each mood to REAL venue category slugs (see constants/categories.ts) so a
// future, safe integration can prioritise/filter already-loaded results without
// fabricating data. Until that exists, the map is unused at runtime by design.
// ─────────────────────────────────────────────────────────────────────────

export type MoodId =
  | 'adventurous'
  | 'creative'
  | 'calm'
  | 'curious'
  | 'active'
  | 'silly'
  | 'outdoors'
  | 'treat';

export interface MoodOption {
  id: MoodId;
  label: string;
  /** Tasteful emoji marker for the compact tile. */
  emoji: string;
  /** Soft pastel tile background (low-alpha so it reads on the paper bubble). */
  tile: string;
}

// Deterministic order + controlled pastels (no random colours/sizes).
export const MOODS: readonly MoodOption[] = [
  { id: 'adventurous', label: 'Adventurous', emoji: '🧭', tile: 'rgba(242,162,75,0.20)' },
  { id: 'creative',    label: 'Creative',    emoji: '🎨', tile: 'rgba(167,139,250,0.20)' },
  { id: 'calm',        label: 'Calm',        emoji: '🌿', tile: 'rgba(122,178,140,0.22)' },
  { id: 'curious',     label: 'Curious',     emoji: '🔍', tile: 'rgba(122,162,212,0.22)' },
  { id: 'active',      label: 'Active',      emoji: '🤸', tile: 'rgba(244,114,114,0.18)' },
  { id: 'silly',       label: 'Silly',       emoji: '🤪', tile: 'rgba(245,200,80,0.24)' },
  { id: 'outdoors',    label: 'Outdoors',    emoji: '🌳', tile: 'rgba(95,208,138,0.20)' },
  { id: 'treat',       label: 'Treat Day',   emoji: '🍦', tile: 'rgba(244,114,182,0.18)' },
] as const;

/**
 * Mood → real venue category slugs (constants/categories.ts). Best-effort,
 * isolated mapping for a FUTURE result-prioritisation integration. Not yet wired
 * to any query or ranking (see file header). Slugs are all real, so nothing here
 * fabricates a category that doesn't exist.
 */
export const MOOD_CATEGORY_MAP: Record<MoodId, readonly string[]> = {
  adventurous: ['outdoor-sports', 'trampoline', 'soft-play'],
  creative:    ['arts', 'sensory', 'library'],
  calm:        ['park', 'library', 'cafe'],
  curious:     ['farm', 'sensory', 'library'],
  active:      ['sports', 'soft-play', 'trampoline', 'swimming', 'outdoor-sports'],
  silly:       ['indoor-play', 'soft-play', 'bowling'],
  outdoors:    ['park', 'farm', 'outdoor-sports'],
  treat:       ['cafe', 'bowling'],
};
