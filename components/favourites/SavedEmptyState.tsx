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
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

const C = {
  coral: '#FF6B6B',
  coralSoft: 'rgba(255,107,107,0.14)',
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
  title: { fontFamily: FontFamily.display, fontSize: 20, color: Colors.label, textAlign: 'center' },
  sub: { fontFamily: FontFamily.body, fontSize: 14, color: Colors.label3, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  cta: {
    marginTop: 22,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.pill,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  ctaText: { fontFamily: FontFamily.bodyStrong, fontSize: 14, color: '#FFFFFF' },
});
