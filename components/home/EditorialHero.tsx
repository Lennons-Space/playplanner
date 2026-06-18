// ─────────────────────────────────────────────────────────────────────────
// EditorialHero — Home's ALWAYS-ON "what should we do today?" hero.
//
// It never shows a venue. It surfaces ONE existing Discover collection as a
// magazine cover (CollectionHeroCard) and opens that collection's page on tap.
// Selection uses existing weather + season logic ONLY:
//   • rain → "Rainy Day"
//   • otherwise → the seasonal hero (Summer Adventures / etc.)
//
// No new query (coarse FALLBACK_LOCATION weather is the SAME fetch the global
// WeatherBackground already makes — React Query dedupes it), no location
// consent, no OS prompt, no fabricated venue/popularity. Routing is owned by
// Home and passed in, so this component never imports expo-router.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useWeather } from '@/hooks/useWeather';
import { FALLBACK_LOCATION } from '@/constants/location';
import { getSeasonalCollection, getCollection } from '@/lib/collections';
import { GoodForTodayFallback } from './GoodForTodayFallback';

export interface EditorialHeroProps {
  /** Open a collection page by key (routing lives in Home → no expo-router here). */
  onOpenCollection: (key: string) => void;
}

export function EditorialHero({ onOpenCollection }: EditorialHeroProps) {
  // Coarse weather only — same source/key as the global weather background, so
  // React Query serves it from cache (no new fetch) and no OS prompt fires.
  const weather = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  const isRain =
    weather?.condition === 'rain' ||
    weather?.condition === 'drizzle' ||
    weather?.condition === 'showers' ||
    weather?.condition === 'thunderstorm';

  // Existing collection definitions only. Never a fabricated venue.
  const def = useMemo(
    () => (isRain ? getCollection('rainy-day') ?? getSeasonalCollection() : getSeasonalCollection()),
    [isRain],
  );

  return <GoodForTodayFallback def={def} onPress={() => onOpenCollection(def.key)} />;
}
