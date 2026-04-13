// ============================================================
// Play Planner — Design system constants
// Use these throughout the app for consistent styling.
// ============================================================

export const Colors = {
  // Brand — Direction 2 (Blue Sky Afternoon): sky/teal is primary; coral is action/alert only.
  coral:      '#FF6B6B',   // action/alert: stars, destructive, status badges
  coralLight: '#FF8E8E',
  coralDark:  '#E05555',
  sky:        '#4ECDC4',   // PRIMARY: CTAs, FAB, profile header, active states
  skyLight:   '#72D9D2',
  skyDark:    '#3AB5AC',
  sun:        '#FFE66D',   // highlights, premium badges
  mint:       '#7DD4C4',   // updated: more saturated, closer to teal family
  // Neutral
  slate:      '#F0F7F7',   // page/screen background (root SafeAreaView)
  slateDark:  '#E0F0EF',
  sand:       '#FFF9F0',   // card / inner container background (layered on top of slate)
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
