// Verifies the optional WeatherTheme "glass" variant on the QuickPicks intent
// chips. Default / light theme keeps the dark paper labels; a dark theme
// (rain/night) flips labels to white so the chips read on the navy sky.

import React from 'react';
import { render } from '@testing-library/react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { WEATHER_THEMES } from '@/lib/weatherTheme';

describe('QuickPicks glass theming', () => {
  it('uses dark label text by default', () => {
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe('#16151A');
  });

  it('keeps dark label text on a LIGHT theme (sunny)', () => {
    const { getByText } = render(<QuickPicks onPick={jest.fn()} theme={WEATHER_THEMES.sunny} />);
    expect(getByText('Rainy Day').props.style.color).toBe('#16151A');
  });

  it('flips label text to white on a DARK theme (rain)', () => {
    const { getByText } = render(<QuickPicks onPick={jest.fn()} theme={WEATHER_THEMES.rain} />);
    expect(getByText('Rainy Day').props.style.color).toBe('#FFFFFF');
  });
});
