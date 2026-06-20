// Verifies the optional WeatherTheme "glass" variant on VenueCard (used only on
// Home for rain/night). The default and light-theme renders must stay the solid
// surface card (now the dark v2 `Colors.surface`) so every other screen that
// renders VenueCard is unaffected.

import React from 'react';
import { render } from '@testing-library/react-native';
import { VenueCard } from '@/components/ui/VenueCard';
import { WEATHER_THEMES, type WeatherTheme } from '@/lib/weatherTheme';
import { Colors } from '@/constants/theme';
import type { Venue } from '@/types';

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

describe('VenueCard glass theming', () => {
  it('is a solid surface card by default (no theme)', () => {
    expect(rootStyle().backgroundColor).toBe(Colors.surface);
  });

  it('stays solid on a LIGHT theme (sunny) — solid surface preserved', () => {
    expect(rootStyle(WEATHER_THEMES.sunny).backgroundColor).toBe(Colors.surface);
  });

  it('becomes a frosted glass card on a DARK theme (rain)', () => {
    const style = rootStyle(WEATHER_THEMES.rain);
    expect(style.backgroundColor).toBe('rgba(255,255,255,0.12)');
    expect(style.borderColor).toBe('rgba(255,255,255,0.16)');
  });

  it('becomes a frosted glass card on a DARK theme (night)', () => {
    expect(rootStyle(WEATHER_THEMES.night).backgroundColor).toBe('rgba(255,255,255,0.12)');
  });
});
