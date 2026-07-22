// ─────────────────────────────────────────────────────────────────────────
// SavedEmptyState — the empty state for the Saved tab (no saved venues).
//
// Play Planner v2 dark spec (prototype: SavedScreen empty branch in
// .design-v2-handoff/pp2-venue.jsx): 80×80 surface tile with an outline
// heart, display title, one line of copy, and ONE solid-accent recovery CTA
// into Discover. Presentational only — no data, no fabricated venues.
// Extracted to its own file so it is unit-testable without pulling in the
// Saved screen's Supabase / auth import graph.
//
// NO function styles: the installed dev build's NativeWind 4 interop silently
// drops style-as-function props on Pressable — static styles + android_ripple
// only (see memory: nativewind-function-style-bug).
// ─────────────────────────────────────────────────────────────────────────

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/ui';
import { ocean, FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

const ACCENT = ocean;

export function SavedEmptyState() {
  const { tokens: T } = useAppTheme();
  return (
    <View style={s.wrap}>
      <View style={[s.iconTile, { backgroundColor: T.surface, borderColor: T.separator }]}>
        <Icon name="heart" size={36} color={T.label3} />
      </View>
      <Text style={[s.title, { color: T.label }]}>Nothing saved yet</Text>
      <Text style={[s.sub, { color: T.label3 }]}>Tap the heart on any venue to save it here for later.</Text>
      <Pressable
        style={s.cta}
        android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
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
  // Prototype: padding '52px 32px', centred column.
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 52,
    paddingHorizontal: 32,
  },
  iconTile: {
    width: 80,
    height: 80,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: FontFamily.display,
    fontSize: 22,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  sub: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 25, // prototype 1.65
    maxWidth: 260,
    marginBottom: 26,
  },
  cta: {
    backgroundColor: ACCENT.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  ctaText: {
    fontFamily: FontFamily.caption,
    fontSize: 15.5,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
});
