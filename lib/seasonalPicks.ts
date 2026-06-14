// ─────────────────────────────────────────────────────────────────────────
// Seasonal Picks — deterministic, month-based "what's good this season" theme.
//
// Pure + lightweight: no external API, no network, no date library. The chosen
// theme maps to REAL venue category slugs (constants/categories) so the Home
// section can group ALREADY-LOADED venues client-side into a seasonal
// collection — it never fabricates a category or a "season".
//
// Christmas/Winter lean to cosy INDOOR family spots (we have no event/market
// category), Spring/Summer/Autumn lean OUTDOOR — all using slugs that actually
// exist, so a collection only renders when ≥3 real matching venues are present.
// ─────────────────────────────────────────────────────────────────────────

export interface SeasonalTheme {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  /** Real category slugs (constants/categories) that belong to this season. */
  slugs: readonly string[];
}

const THEMES = {
  christmas: {
    id: 'christmas',
    emoji: '🎄',
    title: 'Christmas Magic',
    subtitle: 'Festive family days out',
    slugs: ['soft-play', 'indoor-play', 'arts', 'library', 'bowling'],
  },
  winter: {
    id: 'winter',
    emoji: '❄️',
    title: 'Cosy Winter Days',
    subtitle: 'Warm indoor escapes',
    slugs: ['soft-play', 'indoor-play', 'arts', 'library', 'bowling', 'sensory'],
  },
  spring: {
    id: 'spring',
    emoji: '🌸',
    title: 'Spring Explorers',
    subtitle: 'Enjoy the longer days',
    slugs: ['park', 'farm', 'outdoor-sports'],
  },
  easter: {
    id: 'easter',
    emoji: '🐣',
    title: 'Easter Fun',
    subtitle: 'Great activities for the holidays',
    slugs: ['farm', 'park', 'outdoor-sports'],
  },
  summer: {
    id: 'summer',
    emoji: '☀️',
    title: 'Summer Adventures',
    subtitle: 'Make the most of the sunshine',
    slugs: ['park', 'farm', 'outdoor-sports', 'swimming'],
  },
  autumn: {
    id: 'autumn',
    emoji: '🍂',
    title: 'Autumn Walks',
    subtitle: 'Fresh air and colourful leaves',
    slugs: ['park', 'farm', 'outdoor-sports'],
  },
} as const satisfies Record<string, SeasonalTheme>;

/**
 * Deterministic month → theme (0 = January). No weather/API needed.
 *   Dec → Christmas · Jan–Feb → Winter · Mar/May → Spring · Apr → Easter
 *   Jun–Aug → Summer · Sep–Nov → Autumn
 */
export function getSeasonalTheme(date: Date = new Date()): SeasonalTheme {
  switch (date.getMonth()) {
    case 11:
      return THEMES.christmas;
    case 0:
    case 1:
      return THEMES.winter;
    case 2:
    case 4:
      return THEMES.spring;
    case 3:
      return THEMES.easter;
    case 5:
    case 6:
    case 7:
      return THEMES.summer;
    case 8:
    case 9:
    case 10:
      return THEMES.autumn;
    default:
      return THEMES.spring;
  }
}
