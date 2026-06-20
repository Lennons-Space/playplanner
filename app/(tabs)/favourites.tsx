/**
 * Saved tab — Play Planner v2 saved grid.
 *
 * 2-column grid of square image tiles (full-bleed photo, bottom gradient, name
 * overlay, top-right heart toggle), per the v2 design (pp2-venue.jsx SavedScreen
 * / screens/04-saved-dark.png).
 *
 * RLS note: .eq('user_id', user.id) is belt-and-braces — RLS on the
 * `favourites` table is the authoritative security boundary.
 *
 * Data minimisation: we only select columns the UI actually needs.
 * venue_photos is joined and resolved to a single cover_photo_url
 * client-side; the raw array is never stored in component state.
 */

import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useUser, useProfile } from '@/hooks/useAuth';
import { Icon, CategoryPlaceholder } from '@/components/ui';
import { SavedEmptyState } from '@/components/favourites/SavedEmptyState';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type FavVenue = {
  id: string;
  venue_id: string;
  venue: {
    id: string;
    name: string;
    is_premium: boolean;
    average_rating: number;
    cover_photo_url: string | null;
    category: { id: string; name: string; icon: string; color: string; slug: string } | null;
  } | null;
};

const H_PAD = 16;
const CARD_GAP = 10;

// ─── SavedTile ──────────────────────────────────────────────────────────────
// Square full-bleed tile: photo → bottom gradient → name → heart toggle.
function SavedTile({
  item,
  onPress,
  onUnsave,
}: {
  item: FavVenue;
  onPress: () => void;
  onUnsave: () => void;
}) {
  // Explicit tile size from window width — avoids the Android collapse where
  // aspectRatio + flex with only absolutely-positioned children resolves to 0
  // height. Two tiles + one gap fill the padded row width.
  const { width } = useWindowDimensions();
  const size = Math.floor((width - H_PAD * 2 - CARD_GAP) / 2);

  const venue = item.venue;
  // Empty slot keeps grid column alignment when venue data is null.
  if (!venue) return <View style={{ width: size }} />;

  const hasPhoto = !!venue.cover_photo_url;

  return (
    <Pressable
      style={({ pressed }) => [styles.tile, { width: size, height: size, opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={venue.name}
    >
      {/* Base layer — in-flow child with explicit size so the tile has height. */}
      {hasPhoto ? (
        <Image source={{ uri: venue.cover_photo_url! }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <CategoryPlaceholder categorySlug={venue.category?.slug ?? 'other'} size={size} borderRadius={0} />
      )}

      {/* Bottom gradient for legible name */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Text style={styles.tileName} numberOfLines={2}>{venue.name}</Text>

      {/* Heart toggle — always saved here; tapping removes it */}
      <Pressable
        style={styles.heartBtn}
        onPress={onUnsave}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${venue.name} from saved`}
        hitSlop={8}
      >
        <Icon name="heartFill" size={13} color={Colors.coral} />
      </Pressable>
    </Pressable>
  );
}

// ─── SavedScreen ─────────────────────────────────────────────────────────────
export default function FavouritesScreen() {
  const user = useUser();
  const profile = useProfile();
  const queryClient = useQueryClient();

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // ── Data query (preserved verbatim) ────────────────────────────────────────
  const { data: favRows = [], isLoading, isError } = useQuery<FavVenue[]>({
    queryKey: ['favourites', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('favourites')
        .select(`
          id,
          venue_id,
          venue:venues (
            id, name, is_premium, average_rating,
            category:categories ( id, name, icon, color, slug ),
            venue_photos ( url, is_cover, sort_order, status )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data ?? []).map((row) => {
        const v = row.venue as (typeof row.venue & {
          venue_photos?: { url: string; is_cover: boolean; sort_order: number; status: string }[];
        }) | null;

        const approved = (v?.venue_photos ?? []).filter((p) => p.status === 'approved');
        const cover = approved.find((p) => p.is_cover) ?? approved[0] ?? null;

        return {
          id: row.id,
          venue_id: row.venue_id,
          venue: v ? {
            id: v.id,
            name: v.name,
            is_premium: v.is_premium ?? false,
            average_rating: v.average_rating == null ? 0 : Number(v.average_rating),
            cover_photo_url: cover?.url ?? null,
            category: v.category ?? null,
          } : null,
        } as FavVenue;
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });

  // ── Unsave mutation (preserved verbatim) ────────────────────────────────────
  const unsaveMutation = useMutation({
    mutationFn: async (favouriteId: string) => {
      const { error } = await supabase
        .from('favourites')
        .delete()
        .eq('id', favouriteId)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourites', user?.id] });
    },
  });

  const handlePress = useCallback((venueId: string) => {
    router.push(`/venue/${venueId}`);
  }, []);

  const showEmpty = favRows.length === 0;

  // ── List header (v2: overline + "Your favourites" + count) ─────────────────
  const listHeader = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.overline}>{firstName ? `${firstName}'s saved places` : 'Saved places'}</Text>
        <Text style={styles.title}>Your favourites</Text>
      </View>
      {favRows.length > 0 && (
        <Text style={styles.count}>{favRows.length} saved</Text>
      )}
    </View>
  );

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centred}>
          <View style={styles.heartMedallion}>
            <Icon name="heartFill" size={30} color={Colors.coral} />
          </View>
          <Text style={styles.emptyTitle}>Save your favourite places</Text>
          <Text style={styles.emptySub}>
            Sign in to keep a personal list of venues your family loves.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in to save favourites"
          >
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtnWrap}
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>Create an account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centred}>
          <Icon name="info" size={40} color={Colors.label3} />
          <Text style={styles.emptyTitle}>Could not load saved places</Text>
          <Text style={styles.emptySub}>Check your connection and try again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Signed-in grid view ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {showEmpty ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.emptyScrollContent}>
          {listHeader}
          <SavedEmptyState />
          <View style={styles.bottomPad} />
        </ScrollView>
      ) : (
        <FlatList
          data={favRows}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          ListFooterComponent={<View style={styles.bottomPad} />}
          renderItem={({ item }) => (
            <SavedTile
              item={item}
              onPress={() => handlePress(item.venue_id)}
              onUnsave={() => unsaveMutation.mutate(item.id)}
            />
          )}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Transparent so the global weather layer (app/(tabs)/_layout) shows through.
    backgroundColor: 'transparent',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // ── Header ────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingTop: 14,
    paddingBottom: 14,
  },
  overline: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: Colors.accent,
  },
  title: {
    fontFamily: FontFamily.display,
    fontSize: 28,
    color: Colors.label,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginTop: 2,
  },
  count: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: Colors.label3,
    marginBottom: 4,
  },

  // ── Grid layout ───────────────────────────────────────────────────
  listContent: { paddingBottom: 32 },
  columnWrapper: {
    paddingHorizontal: H_PAD,
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  emptyScrollContent: { flexGrow: 1 },
  bottomPad: { height: 110 },

  // ── Square tile (explicit size set inline from window width) ──────
  tile: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  tileName: {
    position: 'absolute',
    left: 10,
    right: 34,
    bottom: 9,
    fontFamily: FontFamily.bodyStrong,
    fontSize: 12,
    color: '#FFFFFF',
    lineHeight: 15,
  },
  heartBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty / not-signed-in / error shared ──────────────────────────
  heartMedallion: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,107,107,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontFamily: FontFamily.display,
    fontSize: 20,
    color: Colors.label,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: Colors.label3,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 21,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.pill,
    paddingVertical: 14,
    paddingHorizontal: 36,
    marginTop: 18,
  },
  primaryBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryBtnWrap: {
    marginTop: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: Colors.accent,
  },
});
