// ─────────────────────────────────────────────────────────────────────────
// SavedEmptyState — the empty state for the Favourites tab (no saved venues).
//
// One intentional central composition: a soft heart medallion (PlayPlanner's
// own heart icon, not a system emoji), the title, a short line, and ONE recovery
// CTA into Discover. This is an empty-state recovery path (not a duplicate Home
// action), so the CTA is appropriate. Presentational only — no data, no
// fabricated venues. Extracted to its own file so it is unit-testable without
// pulling in the Favourites screen's Supabase / auth import graph.
// ─────────────────────────────────────────────────────────────────────────

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/ui';

const C = {
  ink: '#1D2630',
  mute: '#7B8794',
  coral: '#FF6B6B',
  coralSoft: '#FFE8E8',
  // CTA: soft translucent cream pill + dark warm-amber text — a clear but
  // restrained action (deliberately quieter than Home's solid accent CTA).
  amber: '#9A5A14',
  cream: 'rgba(255,252,246,0.82)',
  creamBorder: 'rgba(28,20,8,0.09)',
} as const;

export function SavedEmptyState() {
  return (
    <View style={s.wrap}>
      <View style={s.iconCircle}>
        <Icon name="heartFill" size={34} color={C.coral} />
      </View>
      <Text style={s.title}>Nothing saved yet</Text>
      <Text style={s.sub}>Tap the heart on any place to keep it here.</Text>
      <Pressable
        style={({ pressed }) => [s.cta, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push('/discover')}
        accessibilityRole="button"
        accessibilityLabel="Explore places"
      >
        <Text style={s.ctaText}>Explore places →</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  // flex:1 keeps the composition centred on both short and tall screens.
  // paddingBottom nudges it slightly ABOVE dead-centre so it isn't perfectly
  // framed inside the sunny background circle behind it.
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 56 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontFamily: 'Nunito-ExtraBold', fontSize: 20, color: C.ink, textAlign: 'center' },
  sub: { fontFamily: 'Nunito-Regular', fontSize: 14, color: C.mute, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  cta: {
    marginTop: 22,
    backgroundColor: C.cream,
    borderWidth: 1,
    borderColor: C.creamBorder,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  ctaText: { fontFamily: 'Nunito-Bold', fontSize: 14, color: C.amber },
});
