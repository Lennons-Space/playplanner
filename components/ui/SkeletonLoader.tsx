import { useEffect, useRef } from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BorderRadius } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { ThemedBackground } from '@/components/ui/ThemedBackground';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  /** Optional extra style overrides — applied after the base skeleton styles. */
  style?: ViewStyle;
}

// ── Theme-aware shimmer fill ──────────────────────────────────────────────
// Root cause of the "cream flash" bug: this used to hardcode
// `Colors.surface2` (#F2EBDD, a solid warm cream) regardless of app theme.
// On the v2 dark screens (Venue Detail, Home) that painted a bright opaque
// cream block over the shared <ThemedBackground/> atmosphere every time
// something loaded — the exact same legacy-light-only-Colors bug as
// VenueCard.
//
// Fix: a dedicated translucent tint per resolved mode (useAppTheme()), local
// to this component rather than reusing constants/theme's `tokens.fill`
// (calibrated for icon-button fills, a different visual weight than a
// shimmering skeleton block):
//   - dark:  a light frosted tint (matches the app's existing dark "glass"
//     card convention, see lib/weatherTheme.ts GLASS_CARD) — translucent, so
//     the atmosphere stays visible through it, never an opaque cream/white slab.
//   - light: a warm-neutral ink tint (from the same warm-black used for the
//     Discover collection hero's "INK" text colour) at low opacity — reads as
//     a pale, warm neutral, never the cold-grey Themes.light.surface2 and
//     never the old opaque cream.
// The existing Animated.loop shimmer (opacity 0.4 → 0.9), props API, and
// loading semantics are all unchanged — only the base fill colour is now
// theme-aware.
const SKELETON_FILL = {
  dark: 'rgba(255,255,255,0.14)',
  light: 'rgba(28,20,8,0.08)',
} as const;

export function Skeleton({ width = '100%', height = 14, borderRadius = BorderRadius.sm, style }: SkeletonProps) {
  const { mode } = useAppTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: SKELETON_FILL[mode], opacity }, style]}
    />
  );
}

export function VenueRowSkeleton() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
      <Skeleton width={44} height={44} borderRadius={BorderRadius.section} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="65%" height={13} />
        <Skeleton width="40%" height={11} />
      </View>
    </View>
  );
}

// ─── VenueDetailSkeleton ────────────────────────────────────────────────────
// Full-page loading state for Venue Detail (app/venue/[id].tsx), promoted
// here (Phase 4, loading-state design system) from a screen-local
// `LoadingSkeleton` function that hand-assembled the same blocks. Matches
// the real screen's hero+sheet+stat-strip layout dimensions exactly (300px
// hero, title/meta block, 3-tile pill row, one full-width card) so there is
// no layout jump when the real content mounts.
//
// Mounts its own <ThemedBackground/>/<SafeAreaView/>/<StatusBar/> — the same
// three things app/venue/[id].tsx's own loaded and error states each mount
// independently at their own root return. This is a pre-existing,
// screen-wide pattern (all three states — loading/error/loaded — are
// separate early-return trees, not one tree with a state switch inside it)
// that this promotion intentionally leaves unchanged rather than
// restructuring; see the screen's own component for why a full merge into a
// single persistent root was judged out of scope for this pass.
export function VenueDetailSkeleton() {
  const { mode } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Skeleton width="100%" height={300} borderRadius={0} />
      <View style={{ padding: 20, gap: 12 }}>
        <Skeleton width="70%" height={28} borderRadius={8} />
        <Skeleton width="45%" height={14} borderRadius={6} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Skeleton width={80} height={32} borderRadius={999} />
          <Skeleton width={80} height={32} borderRadius={999} />
          <Skeleton width={80} height={32} borderRadius={999} />
        </View>
        <Skeleton width="100%" height={60} borderRadius={18} style={{ marginTop: 8 }} />
      </View>
    </SafeAreaView>
  );
}

// ─── ListPageSkeleton ───────────────────────────────────────────────────────
// Generic full-page loading state for list-style pages (Search results, Map
// list view, Saved/Favourites-style screens) — a header placeholder plus a
// few stacked `VenueRowSkeleton` rows, reusing the exact row layout already
// established for Home/collection loading so a list screen's skeleton never
// diverges from what the real rows look like once they arrive.
//
// Deliberately does NOT mount <ThemedBackground/> itself (unlike
// VenueDetailSkeleton above) — list-style screens already mount the shared
// background once at their own screen root and must render this INSIDE that
// already-mounted tree (conditionally, alongside the real list), never as a
// competing sibling root that gets swapped in/out — otherwise the shared
// atmosphere remounts (and any weather animation restarts) every time the
// query resolves. Callers own their own background/header chrome; this only
// supplies the loading body.
export function ListPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 }}>
        <Skeleton width="55%" height={22} borderRadius={8} />
        <Skeleton width="35%" height={13} borderRadius={6} />
      </View>
      {Array.from({ length: rows }).map((_, i) => (
        <VenueRowSkeleton key={i} />
      ))}
    </View>
  );
}
