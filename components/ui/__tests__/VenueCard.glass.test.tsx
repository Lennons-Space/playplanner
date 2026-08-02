// Verifies VenueCard's two independent colour behaviours:
//   1. The SOLID ("paper") card resolves its surface from useAppTheme() —
//      dark app theme -> the v2 dark surface, light app theme -> the same
//      white paper the card has always used (byte-identical, since
//      Themes.light.surface === the old hardcoded Colors.surface, see
//      constants/theme.ts and components/ui/VenueCard.tsx).
//   2. The optional WeatherTheme "glass" override (used only on Home for
//      rain/night) still WINS over the resolved app theme when present —
//      a light WeatherTheme (sunny) stays solid; a dark WeatherTheme
//      (rain/night) always becomes frosted glass, regardless of app theme.
//
// useColorScheme is mocked locally (overriding jest.setup.js's global 'dark'
// default) so every case below is deterministic and independent of that
// global default — same pattern as hooks/__tests__/useAppTheme.test.tsx.

import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { VenueCard } from '@/components/ui/VenueCard';
import { useThemeStore } from '@/store/themeStore';
import { WEATHER_THEMES, type WeatherTheme } from '@/lib/weatherTheme';
import type { Venue } from '@/types';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

beforeEach(() => {
  mockUseColorScheme.mockReset();
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

function makeVenue(): Venue {
  return {
    id: 'v1',
    name: 'Test Venue',
    category: undefined,
    min_age: 0,
    max_age: 12,
    review_count: 0,
    average_rating: 0,
    distance_km: 1,
    cover_photo_url: null,
    featured_until: null,
    opening_hours: [],
    photos: [],
    facilities: [],
  } as unknown as Venue;
}

// The card root is a Pressable with a plain style object; read its colours.
function rootStyle(theme?: WeatherTheme): Record<string, unknown> {
  const root = render(<VenueCard venue={makeVenue()} theme={theme} />).toJSON() as {
    props: { style: Record<string, unknown> };
  };
  return root.props.style;
}

describe('VenueCard — solid card resolves from useAppTheme()', () => {
  it('is the v2 LIGHT surface when the app theme resolves to light (no WeatherTheme)', () => {
    mockUseColorScheme.mockReturnValue('light');
    expect(rootStyle().backgroundColor).toBe('#FFFFFF');
  });

  it('is the v2 DARK surface when the app theme resolves to dark (no WeatherTheme) — the bug this fixes', () => {
    mockUseColorScheme.mockReturnValue('dark');
    expect(rootStyle().backgroundColor).toBe('#17171F');
  });

  it('stays solid (not glass) on a LIGHT WeatherTheme (sunny), matching the resolved app theme', () => {
    mockUseColorScheme.mockReturnValue('light');
    expect(rootStyle(WEATHER_THEMES.sunny).backgroundColor).toBe('#FFFFFF');
  });
});

describe('VenueCard — glass WeatherTheme override always wins', () => {
  it('becomes a frosted glass card on a DARK WeatherTheme (rain) even in a light app theme', () => {
    mockUseColorScheme.mockReturnValue('light');
    const style = rootStyle(WEATHER_THEMES.rain);
    expect(style.backgroundColor).toBe('rgba(255,255,255,0.12)');
    expect(style.borderColor).toBe('rgba(255,255,255,0.16)');
  });

  it('becomes a frosted glass card on a DARK WeatherTheme (night) even in a dark app theme', () => {
    mockUseColorScheme.mockReturnValue('dark');
    expect(rootStyle(WEATHER_THEMES.night).backgroundColor).toBe('rgba(255,255,255,0.12)');
  });
});
