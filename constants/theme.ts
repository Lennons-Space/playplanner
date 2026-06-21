// ============================================================
// Play Planner — Design system constants v2
//
// Reskin direction: Claude Design handoff (June 2026)
// Light mode only for launch. Dark mode values in comments.
// ============================================================

import { StyleSheet } from 'react-native';

// ── Colour palette ──────────────────────────────────────────

export const Colors = {

  // ── Screen backgrounds ──────────────────────────────────
  bg:        '#F6F1E6',   // dark: '#0C0C11'
  warm:      '#FBF6EC',   // dark: '#0E0E14' — home screen base

  // ── Surface / card backgrounds ──────────────────────────
  surface:   '#FFFFFF',   // dark: '#17171F'
  surface2:  '#F2EBDD',   // dark: '#1F1F29' — elevated panels

  // ── Text ────────────────────────────────────────────────
  label:     '#16151A',                      // dark: '#F4F4F6'
  label2:    'rgba(20,18,28,0.74)',          // dark: 'rgba(235,235,245,0.76)'
  label3:    'rgba(20,18,28,0.48)',          // dark: 'rgba(235,235,245,0.44)'
  label4:    'rgba(20,18,28,0.26)',          // dark: 'rgba(235,235,245,0.22)'

  // ── Borders / fills ─────────────────────────────────────
  separator: 'rgba(20,18,28,0.10)',         // dark: 'rgba(255,255,255,0.08)'
  fill:      'rgba(20,18,28,0.05)',         // dark: 'rgba(255,255,255,0.07)'

  // ── Accent — Ocean (default) ─────────────────────────────
  accent:         '#4C8DF6',
  accentLight:    'rgba(76,141,246,0.16)',
  accentTagText:  '#82AEFA',

  // ── Status ──────────────────────────────────────────────
  star:      '#FF9F0A',   // dark: '#FFB23E'
  coral:     '#FF6B6B',   // errors, destructive actions, stars (keep)
  success:   '#00B894',
  warning:   '#FDCB6E',
  error:     '#D63031',
  info:      '#0984E3',

  // ── Intent chip colours (fixed, not theme-dependent) ────
  intentRain:    '#5B9BD5',
  intentEnergy:  '#F2A24B',
  intentFree:    '#5FD08A',
  intentAnimals: '#D7B25A',
  intentToddler: '#E07FA8',
  intentParent:  '#B08A6A',

  // ── Deprecated aliases — remove after components updated ─
  /** @deprecated use bg */ slate:       '#F1F0F4',
  /** @deprecated use bg */ slateDark:   '#E0F0EF',
  /** @deprecated use surface */ sand:   '#FFFFFF',
  /** @deprecated use surface */ sandDark: '#F5F4F8',
  /** @deprecated use surface */ white:  '#FFFFFF',
  /** @deprecated use label */ charcoal: '#16151A',
  /** @deprecated use label2 */ grey:    'rgba(20,18,28,0.74)',
  /** @deprecated use label3 */ greyLight:  'rgba(20,18,28,0.48)',
  /** @deprecated use separator */ greyLighter: 'rgba(20,18,28,0.10)',
  /** @deprecated use accent */ sky:     '#4C8DF6',
  /** @deprecated use accent */ skyLight: '#82AEFA',
  /** @deprecated use accent */ skyDark:  '#2E72E0',
  /** @deprecated */ sun:     '#FFE66D',
  /** @deprecated */ mint:    '#7DD4C4',
  /** @deprecated */ coralLight: '#FF8E8E',
  /** @deprecated */ coralDark:  '#E05555',
};

// ── Font families ───────────────────────────────────────────

export const FontFamily = {
  // New — Bricolage Grotesque (display / headings)
  display:     'BricolageGrotesque_700Bold',
  heading:     'BricolageGrotesque_600SemiBold',

  // New — Hanken Grotesk (body / UI)
  body:        'HankenGrotesk_500Medium',
  bodyStrong:  'HankenGrotesk_600SemiBold',
  caption:     'HankenGrotesk_700Bold',

  // System — tab bar only
  ui:          'System',

  // Deprecated — Nunito (keep loaded during transition, remove after all refs updated)
  // NOTE: values match the local TTF names loaded in _layout.tsx (dash format),
  // not the expo-google-fonts underscore format, so existing components continue
  // to resolve correctly until they are migrated to the new font keys above.
  /** @deprecated use body */ regular:   'Nunito-Regular',
  /** @deprecated use body */ medium:    'Nunito-Medium',
  /** @deprecated use heading */ bold:   'Nunito-Bold',
  /** @deprecated use display */ extraBold: 'Nunito-ExtraBold',
};

// ── Font sizes ──────────────────────────────────────────────

export const FontSize = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  '2xl': 26,   // featured venue name (was 24)
  '3xl': 30,
  '4xl': 36,
};

// ── Spacing ─────────────────────────────────────────────────

export const Spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  '2xl': 32,
  '3xl': 48,

  // Named values for new design patterns
  cardPad:  11,   // internal card padding
  searchV:  14,   // search bar vertical padding
  searchH:  16,   // search bar horizontal padding
};

// ── Border radius ───────────────────────────────────────────

export const BorderRadius = {
  // New scale
  iconContainer:   8,    // settings row icon box
  intentChipIcon:  13,   // intent chip emoji icon box
  section:         14,   // grouped info card / settings section
  chip:            18,   // intent chips, search bar
  card:            24,   // all standard cards
  featured:        26,   // featured hero card
  pill:            999,  // age filter, facility tags, trust pills

  // Aliases for migration (old names → new values)
  /** @deprecated use iconContainer */ sm:   8,
  /** @deprecated use section */       md:   14,
  /** @deprecated use card */          lg:   20,
  /** @deprecated use featured */      xl:   26,
  full: 9999,
};

// ── Shadows ─────────────────────────────────────────────────
//
// NOTE: The new card design uses a 1px inset border as the "shadow",
// not a drop shadow. React Native does not support inset shadows.
// Implement card borders as:
//   borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.separator
//
// Drop shadows below are for the featured hero card only.

export const Shadow = {
  // Featured hero card drop shadow
  featured: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.8,
    shadowRadius: 24,
    elevation: 16,
  },

  // Kept for backward compat during migration
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

// ── Card border helper ──────────────────────────────────────
// Use instead of Shadow.sm/md for new-design cards.
export const CardBorder = StyleSheet.create({
  standard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.separator,
  },
});

// ============================================================
// Themes — Phase 1 Home reskin (additive, June 2026)
//
// Ported verbatim from the design handoff's `window.PP_THEMES` (dark + light
// token sets) plus the "Ocean" accent palette. These are intentionally
// SEPARATE from the `Colors` export above — other screens still consume
// `Colors` (light-only) and will be migrated to `Themes` in a later phase.
//
// Do NOT merge these into `Colors` and do NOT change `Colors` to read from
// here — that would re-theme every existing screen as a side effect.
// ============================================================

export interface ThemeTokens {
  mode: 'dark' | 'light';
  bg: string;
  warm: string;
  surface: string;
  surface2: string;
  label: string;
  label2: string;
  label3: string;
  label4: string;
  separator: string;
  fill: string;
  fill2: string;
  star: string;
  appBg: string;
}

export const Themes: { dark: ThemeTokens; light: ThemeTokens } = {
  dark: {
    mode: 'dark',
    bg: '#0C0C11',
    warm: '#0E0E14',
    surface: '#17171F',
    surface2: '#1F1F29',
    label: '#F4F4F6',
    label2: 'rgba(235,235,245,0.76)',
    label3: 'rgba(235,235,245,0.44)',
    label4: 'rgba(235,235,245,0.22)',
    separator: 'rgba(255,255,255,0.08)',
    fill: 'rgba(255,255,255,0.07)',
    fill2: 'rgba(255,255,255,0.04)',
    star: '#FFB23E',
    appBg: '#060608',
  },
  light: {
    mode: 'light',
    bg: '#F1F0F4',
    warm: '#FBFAFC',
    surface: '#FFFFFF',
    surface2: '#F5F4F8',
    label: '#16151A',
    label2: 'rgba(20,18,28,0.74)',
    label3: 'rgba(20,18,28,0.48)',
    label4: 'rgba(20,18,28,0.26)',
    separator: 'rgba(20,18,28,0.10)',
    fill: 'rgba(20,18,28,0.05)',
    fill2: 'rgba(20,18,28,0.03)',
    star: '#FF9F0A',
    appBg: '#E4E3E8',
  },
};

// ── Ocean accent palette (default) ───────────────────────────
// Matches README "Accent Palettes" — used by the new Home alongside `Themes`.
export interface AccentPalette {
  accent: string;
  light: string;
  tagText: string;
}

export const ocean: AccentPalette = {
  accent: '#4C8DF6',
  light: 'rgba(76,141,246,0.16)',
  tagText: '#82AEFA',
};
