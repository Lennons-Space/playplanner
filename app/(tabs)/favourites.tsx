/**
 * Favourites tab — 2-column card grid of saved venues.
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
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useUser, useProfile } from '@/hooks/useAuth';
import { Icon, ScreenTitle, CategoryPlaceholder } from '@/components/ui';
import { SavedEmptyState } from '@/components/favourites/SavedEmptyState';
import { getCategoryMeta } from '@/constants/categories';

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

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  ink:      '#1D2630',
  inkSoft:  '#4A5560',
  mute:     '#7B8794',
  line:     '#E6E2DB',
  lineSoft: '#F1ECE2',
  sand:     '#FBF6EC',
  paper:    '#FFFFFF',
  sky:      '#2FB8B0',
  skyDeep:  '#1B8A85',
  coral:    '#FF6B6B',
  sun:      '#FFD66B',
  sunSoft:  '#FFF1C7',
  coralSoft:'#FFE8E8',
  star:     '#F5A524',
} as const;

const H_PAD    = 20;
const CARD_GAP = 10;
const IMG_H    = 104;

// ─── FavCard ──────────────────────────────────────────────────────────────────
// Each card in the 2-col grid: image area + info area + unsave button overlay.
function FavCard({
  item,
  onPress,
  onUnsave,
}: {
  item: FavVenue;
  onPress: () => void;
  onUnsave: () => void;
}) {
  const venue = item.venue;
  // Empty slot to preserve grid column layout when venue data is null.
  if (!venue) return <View style={styles.cardPlaceholderSlot} />;

  const catMeta  = getCategoryMeta(venue.category?.slug);
  const hasPhoto = !!venue.cover_photo_url;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={venue.name}
    >
      {/* ── Image area ─────────────────────────────────────────── */}
      <View style={styles.imageArea}>
        {hasPhoto ? (
          <Image
            source={{ uri: venue.cover_photo_url! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          // CategoryPlaceholder expects square dimensions; we stretch it to fill
          // the image area by wrapping it in an absoluteFill container.
          <View style={[StyleSheet.absoluteFill, styles.placeholderWrap]}>
            <CategoryPlaceholder
              categorySlug={venue.category?.slug ?? 'other'}
              size={IMG_H}
              borderRadius={0}
            />
          </View>
        )}

        {/* Unsave button — top-right overlay */}
        <Pressable
          style={styles.unsaveBtn}
          onPress={onUnsave}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${venue.name} from favourites`}
          hitSlop={8}
        >
          <Icon name="heartFill" size={14} color={C.coral} />
        </Pressable>
      </View>

      {/* ── Info area ──────────────────────────────────────────── */}
      <View style={styles.infoArea}>
        <Text style={styles.venueName} numberOfLines={2}>{venue.name}</Text>

        <View style={styles.metaRow}>
          <Icon name="star" size={10} color={C.star} />
          <Text style={styles.ratingText}>
            {Number(venue.average_rating) > 0
              ? Number(venue.average_rating).toFixed(1)
              : '–'}
          </Text>
          <Text style={styles.distanceText}>· nearby</Text>
        </View>

        {venue.category && (
          <View style={[styles.catPill, { backgroundColor: catMeta.soft }]}>
            <Text style={[styles.catPillText, { color: catMeta.color }]}>
              {catMeta.label.toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── FavouritesScreen ─────────────────────────────────────────────────────────
export default function FavouritesScreen() {
  const user         = useUser();
  const profile      = useProfile();
  const queryClient  = useQueryClient();

  // First name from full_name for the eyebrow — same derivation as before.
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // ── Data query (preserved verbatim) ────────────────────────────────────────
  const { data: favRows = [], isLoading, isError } = useQuery<FavVenue[]>({
    queryKey: ['favourites', user?.id],
    queryFn: async () => {
      // Re-check inside queryFn — session may have expired between the enabled
      // check and when React Query actually fires the fetch (e.g. on a cache miss
      // triggered by a navigation event after token expiry).
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

        // Resolve cover photo from the joined array — pick the approved cover,
        // falling back to the first approved photo, then null.
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

  // ── Unsave mutation ─────────────────────────────────────────────────────────
  const unsaveMutation = useMutation({
    mutationFn: async (favouriteId: string) => {
      const { error } = await supabase
        .from('favourites')
        .delete()
        .eq('id', favouriteId)
        .eq('user_id', user!.id); // belt-and-braces; RLS is the real boundary
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourites', user?.id] });
    },
  });

  const handlePress = useCallback((venueId: string) => {
    router.push(`/venue/${venueId}`);
  }, []);

  // ── Derived display state ───────────────────────────────────────────────────
  const showEmpty = favRows.length === 0;

  // ── List header ─────────────────────────────────────────────────────────────
  const listHeader = (
    <View>
      <ScreenTitle
        eyebrow={firstName ? `${firstName}'s` : undefined}
        title="Saved places"
      />
    </View>
  );

  // ── List footer ─────────────────────────────────────────────────────────────
  const listFooter = <View style={styles.bottomPad} />;

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centred}>
          <Text style={styles.notSignedInEmoji}>💛</Text>
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
          <ActivityIndicator color={C.sky} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centred}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Could not load favourites</Text>
          <Text style={styles.emptySub}>Check your connection and try again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Signed-in grid view ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {showEmpty ? (
        // When the active tab has nothing to show, render header + empty state
        // in a plain ScrollView (no FlatList needed).
        <View style={{ flex: 1 }}>
          {/* Favourites-only soft cream scrim — calms the global sunny weather
              circles behind the empty state so the content stays the focus.
              Non-interactive, absolute-fill (no layout impact); keeps the warm
              ambience rather than removing it. Does NOT touch the weather layer. */}
          <View pointerEvents="none" style={styles.emptyScrim} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.emptyScrollContent}
          >
            {listHeader}
            <SavedEmptyState />
            <View style={styles.bottomPad} />
          </ScrollView>
        </View>
      ) : (
        <FlatList
          data={favRows}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          renderItem={({ item }) => (
            <FavCard
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

  // ── FlatList layout ───────────────────────────────────────────────
  listContent: {
    paddingBottom: 32,
  },
  columnWrapper: {
    paddingHorizontal: H_PAD,
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  emptyScrollContent: {
    flexGrow: 1,
  },
  // Soft cream wash over the global sunny background — empty state only.
  emptyScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(251,246,236,0.42)',
  },
  bottomPad: {
    height: 110, // clear tab bar
  },

  // ── Venue card ────────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: C.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    overflow: 'hidden',
  },
  // Zero-width spacer in the grid column when venue data is null,
  // so the sibling card still occupies its correct column.
  cardPlaceholderSlot: {
    flex: 1,
  },
  imageArea: {
    height: IMG_H,
    position: 'relative',
    overflow: 'hidden',
  },
  placeholderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  unsaveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoArea: {
    padding: 10,
  },
  venueName: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
    color: C.ink,
    lineHeight: 13 * 1.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  ratingText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: C.ink,
  },
  distanceText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: C.mute,
  },
  catPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  catPillText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 9,
    letterSpacing: 0.3,
  },

  // ── Shared empty/error copy (used by not-signed-in + error states) ──
  emptyTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 20,
    color: C.ink,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: C.mute,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 14 * 1.5,
  },

  // ── Not signed in ─────────────────────────────────────────────────
  notSignedInEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  errorEmoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: C.sky,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 36,
    marginTop: 8,
  },
  primaryBtnText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryBtnWrap: {
    marginTop: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 14,
    color: C.sky,
  },
});
