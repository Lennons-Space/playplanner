import type { ViewStyle } from 'react-native';

// Shared "paper bubble" — the soft floating-island container that unifies every
// Home section (mood / need today / who's coming / recently viewed / open now).
// Translucent paper fill so the weather wash reads through; large radius; very
// soft iOS shadow. NO Android `elevation` (elevation + a translucent background
// renders an opaque rectangular plate artifact on Android) — depth on Android
// comes from the translucent layering + soft border.
export const SECTION_BUBBLE: ViewStyle = {
  marginHorizontal: 18,
  borderRadius: 32,
  backgroundColor: 'rgba(255,255,255,0.56)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.55)',
  paddingVertical: 18,
  paddingHorizontal: 20,
  shadowColor: '#2A1E0A',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.04,
  shadowRadius: 18,
};
