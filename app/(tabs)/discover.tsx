// ─────────────────────────────────────────────────────────────────────────
// Discover — the inspiration tab (replaces the visible Search tab). NOT a
// search screen: a calm, editorial, magazine-like entry point into curated
// family collections (Headspace / Apple Weather / Apple Music feel). The real
// Search screen stays reachable from the small icon top-right — nothing
// orphaned.
//
// Layout (MVP, deliberately minimal):
//   Discover                       [🔍]
//   Ideas for every kind of day
//   Seasonal Picks
//   Fresh ideas for this season
//   [ seasonal hero — the largest, most premium object ]
//   Ideas for today
//   Explore by mood
//   🔥 Burn Energy · ☔ Rainy Day · 💷 Free Days Out   (staggered bubbles)
//
// The seasonal hero rotates with getSeasonalTheme() (existing logic) and opens
// the reusable collection page via the stable 'seasonal' key. Each collection
// card opens the reusable page with its key. No dead cards, no placeholder
// pages. Privacy: this screen reads no location/profile data; the collection
// page handles location consent itself before any GPS use.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Icon } from '@/components/ui';
import { CollectionCard, type CollectionCardLayout } from '@/components/discover/CollectionCard';
import { DISCOVER_COLLECTIONS, COLLECTIONS, getSeasonalCollection } from '@/lib/collections';

// Decorative emoji corner per tile so the mosaic reads handcrafted, not generated.
const CARD_LAYOUTS: readonly CollectionCardLayout[] = ['right', 'left', 'center'];

// Organic Pinterest heights — deliberately asymmetric (left column 182/156,
// right column 140/174) so the mosaic feels handcrafted and floaty rather than
// a mirrored 2×2 dashboard. Trimmed ~12–14px vs the first pass so tiles read as
// calmer magazine tiles, not chunky blocks.
const TILE_HEIGHTS = [182, 140, 156, 174];

// Side inset for every floating object — generous so cards read as paper pieces
// on sand, not edge-to-edge panels.
const SIDE = 28;
// Gap between the two mosaic columns and between stacked tiles.
const GRID_GAP = 20;

function SectionLabel({ title, subtitle, eyebrow }: { title: string; subtitle?: string; eyebrow?: boolean }) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ paddingHorizontal: SIDE, marginBottom: 18 }}>
      {eyebrow ? (
        // Small uppercase editorial label — minimal visual noise.
        <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12.5, letterSpacing: 1.6, color: tokens.label3 }}>
          {title.toUpperCase()}
        </Text>
      ) : (
        <Text style={{ fontFamily: FontFamily.display, fontSize: 19, color: tokens.label, letterSpacing: -0.4 }}>
          {title}
        </Text>
      )}
      {subtitle != null && (
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: tokens.label2, marginTop: eyebrow ? 5 : 3 }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

export default function DiscoverScreen() {
  const { tokens } = useAppTheme();
  const seasonal = useMemo(() => getSeasonalCollection(), []);

  return (
    <View style={{ flex: 1 }}>
      {/* Weather background lives once, globally, in app/(tabs)/_layout. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          {/* ── Header: title + small search icon (top-right) ───────── */}
          <View
            style={{
              paddingHorizontal: SIDE,
              paddingTop: 12,
              paddingBottom: 34,
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FontFamily.display, fontSize: 34, color: tokens.label, letterSpacing: -0.8 }}>
                Discover
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: tokens.label2, marginTop: 4 }}>
                Ideas for every kind of day
              </Text>
            </View>

            <Pressable
              onPress={() => router.push('/search')}
              accessibilityRole="button"
              accessibilityLabel="Search venues, postcodes and tags"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: tokens.surface,
                borderWidth: 1,
                borderColor: tokens.separator,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 4,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="search" size={19} color={tokens.label} />
            </Pressable>
          </View>

          {/* ── Seasonal Picks — the hero (largest, most premium object) ── */}
          <SectionLabel title="Seasonal Picks" subtitle="Fresh ideas for this season" />
          <View style={{ paddingHorizontal: SIDE, marginBottom: 64 }}>
            <CollectionCard
              def={seasonal}
              hero
              layout="right"
              onPress={() => router.push({ pathname: '/discover/[collection]', params: { collection: 'seasonal' } })}
            />
          </View>

          {/* ── COLLECTIONS — 2-column mosaic ───────────────────────── */}
          <SectionLabel title="Collections" eyebrow />
          {/* Two independent columns (even indices left, odd right) so tiles can
              have different heights and the page reads as a Pinterest/Airbnb
              mosaic rather than a vertical feed. ANY number of future collections
              (Farm Days, Popular With Families, Toddler Adventures, …) flow into
              the mosaic automatically — add them to DISCOVER_COLLECTIONS, no page
              redesign. */}
          <View style={{ flexDirection: 'row', paddingHorizontal: SIDE, gap: GRID_GAP }}>
            {[0, 1].map((col) => (
              <View key={col} style={{ flex: 1, gap: GRID_GAP }}>
                {DISCOVER_COLLECTIONS.map((key, i) =>
                  i % 2 === col ? (
                    <CollectionCard
                      key={key}
                      def={COLLECTIONS[key]}
                      compact
                      compactHeight={TILE_HEIGHTS[i % TILE_HEIGHTS.length]}
                      layout={CARD_LAYOUTS[i % CARD_LAYOUTS.length]}
                      onPress={() => router.push({ pathname: '/discover/[collection]', params: { collection: key } })}
                    />
                  ) : null,
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
