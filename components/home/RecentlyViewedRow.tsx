// ─────────────────────────────────────────────────────────────────────────
// RecentlyViewedRow — "Recently viewed / Continue where you left off".
//
// Local-only (AsyncStorage via useRecentlyViewed). Renders a horizontal row of
// small ExploreCards (size="sm"), reusing the same card so there's no styling
// duplication. Hides itself entirely when there's nothing to show — no
// placeholders, no demo data.
//
// NOTE: there is no "See all" action here. With a hard cap of 10 and all items
// already in the horizontal scroll, a "See all" would have no real destination
// (and there's no recently-viewed screen) — so rather than ship a dead/fake
// action it's omitted. See the report for this deliberate deviation.
// ─────────────────────────────────────────────────────────────────────────

import { FlatList, Text, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { ExploreCard } from './ExploreCard';

export interface RecentlyViewedRowProps {
  /** Navigate to a venue by id (decoupled from the full Venue type). */
  onVenuePress: (venueId: string) => void;
}

export function RecentlyViewedRow({ onVenuePress }: RecentlyViewedRowProps) {
  const { tokens } = useAppTheme();
  const { items, loading } = useRecentlyViewed();

  // Empty / still loading → hide the whole section (no placeholders).
  if (loading || items.length === 0) return null;

  return (
    <View style={{ paddingTop: 24 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ fontFamily: FontFamily.display, fontSize: 20, color: tokens.label, letterSpacing: -0.5 }}>
          Recently viewed
        </Text>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginTop: 3 }}>
          Continue where you left off
        </Text>
      </View>

      <FlatList
        horizontal
        data={items}
        keyExtractor={(v) => v.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}
        accessibilityRole="list"
        accessibilityLabel="Recently viewed venues"
        renderItem={({ item }) => (
          <ExploreCard venue={item} size="sm" onPress={() => onVenuePress(item.id)} />
        )}
      />
    </View>
  );
}
