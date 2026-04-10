// ============================================================
// Play Planner — Design system constants
// Use these throughout the app for consistent styling.
// ============================================================

export const Colors = {
  // Brand
  coral:      '#FF6B6B',   // primary CTA, nav active
  coralLight: '#FF8E8E',
  coralDark:  '#E05555',
  sky:        '#4ECDC4',   // secondary accent
  skyLight:   '#72D9D2',
  sun:        '#FFE66D',   // highlights, badges
  mint:       '#A8E6CF',   // success, open badge
  // Neutral
  sand:       '#FFF9F0',   // background
  sandDark:   '#F5EDE0',   // card background
  white:      '#FFFFFF',
  charcoal:   '#2D3436',   // primary text
  grey:       '#636E72',   // secondary text
  greyLight:  '#B2BEC3',   // disabled, borders
  greyLighter:'#DFE6E9',
  // Semantic
  success:    '#00B894',
  warning:    '#FDCB6E',
  error:      '#D63031',
  info:       '#0984E3',
};

export const FontFamily = {
  regular:   'Nunito-Regular',
  medium:    'Nunito-Medium',
  bold:      'Nunito-Bold',
  extraBold: 'Nunito-ExtraBold',
};

export const FontSize = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  '2xl': 32,
  '3xl': 48,
};

export const BorderRadius = {
  sm:   6,
  md:   12,
  lg:   18,
  xl:   24,
  full: 9999,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 8,
  },
};
