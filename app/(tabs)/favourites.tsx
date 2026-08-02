/**
 * Saved tab — Play Planner v2 dark screen (prototype: SavedScreen in
 * .design-v2-handoff/pp2-venue.jsx, screens/04-saved-dark.png).
 *
 * Structure: eyebrow "Saved places" + display title "Your favourites" +
 * "{n} saved" count, then a 2-column grid of square photo cards (bottom
 * scrim, category badge top-left, name + ★ rating, glass heart = unsave).
 *
 * RLS note: .eq('user_id', user.id) is belt-and-braces — RLS on the
 * `favourites` table is the authoritative security boundary.
 *
 * Data minimisation: we only select columns the UI actually needs.
 * venue_photos is joined and resolved to a single cover_photo_url
 * client-side; the raw array is never stored in component state.
 *
 * Prototype-only data intentionally NOT ported: the distance chip ("0.4 mi")
 * — Saved never reads location (consent rules; only Home's results may), and
 * the open/closed dot — opening hours are not part of this screen's query.
 * The badge dot uses the category colour instead (same language as Home's
 * VenueCard2). No fabricated venues anywhere.
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
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { Icon, CategoryPlaceholder } from '@/components/ui';
import { GlassButton } from '@/components/ui/GlassButton';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { SavedEmptyState } from '@/components/favourites/SavedEmptyState';
import { getCategoryMeta } from '@/constants/categories';
import { ocean, FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

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
// Theme tokens are resolved per-render via useAppTheme() (see FavCard and
// FavouritesScreen below) — the module scope only keeps the mode-independent
// accent palette.
const ACCENT = ocean;
// Prototype literals for the on-photo overlays (not theme tokens by design —
// they sit on photographs, not on the theme surface).
const CARD_STAR = '#FFD166';
const HEART_RED = '#FF6B6B';
// Prototype uses rgba(0,0,0,0.44)/0.38 + backdrop blur(8px). BlurView is
// banned (native module missing from the installed dev build), so the alpha
// is nudged up slightly — the accepted Android-safe glass approximation.
const BADGE_GLASS = 'rgba(0,0,0,0.5)';
const HEART_GLASS = 'rgba(0,0,0,0.45)';

const H_PAD    = 16; // prototype: grid + header padding '0 16px'
const CARD_GAP = 10;

// ─── FavCard ──────────────────────────────────────────────────────────────────
// One square photo card in the 2-col grid (prototype: aspectRatio 1/1, r18,
// bottom scrim, badge top-left, name + rating bottom-left, heart top-right).
// `size` is the computed grid cell (see cardSize in the screen component) —
// an EXPLICIT width/height, never flex:1: with numColumns a flexed card in a
// one-item row stretches to full width, breaking the square grid.
function FavCard({
  item,
  size,
  onPress,
  onUnsave,
}: {
  item: FavVenue;
  size: number;
  onPress: () => void;
  onUnsave: () => void;
}) {
  const { tokens: T } = useAppTheme();
  const venue = item.venue;
  // Empty slot to preserve grid column layout when venue data is null.
  if (!venue) return <View style={{ width: size, height: size }} />;

  const catMeta  = getCategoryMeta(venue.category?.slug);
  const hasPhoto = !!venue.cover_photo_url;
  const rating   = Number(venue.average_rating);

  return (
    // The SIZED element is a plain View — the most primitive RN layout path.
    // Belt-and-braces vs the known on-device style interop trouble with
    // touchable components (see nativewind-function-style-bug): even if the
    // inner touchable's style were mangled on device, the card physically
    // cannot exceed this wrapper (fixed width/height + overflow hidden).
    <View
      style={[
        styles.card,
        { width: size, height: size, borderColor: T.separator, backgroundColor: T.surface },
      ]}
      testID={`saved-card-${venue.id}`}
    >
      <TouchableOpacity
        style={styles.cardTouch}
        onPress={onPress}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={venue.name}
      >
      {/* ── Photo (or dark category placeholder) ───────────────── */}
      {hasPhoto ? (
        <Image
          source={{ uri: venue.cover_photo_url! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <CategoryPlaceholder
          categorySlug={venue.category?.slug ?? 'other'}
          fill
          variant="dark"
        />
      )}

      {/* Bottom scrim so the white name/rating stay legible on any photo. */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']}
        locations={[0.28, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Category badge — top-left (dot = category colour, see header note). */}
      {venue.category && (
        <View style={styles.typeBadge} pointerEvents="none">
          <View style={[styles.typeDot, { backgroundColor: catMeta.color }]} />
          <Text style={styles.typeText} numberOfLines={1}>
            {catMeta.label}
          </Text>
        </View>
      )}

      {/* Name + rating — bottom-left, clear of the heart button. The star
          row only renders when a real numeric rating exists: no reviews →
          no row (never a fabricated value or an awkward "★ –"). */}
      <View style={styles.cardFooter} pointerEvents="none">
        {/* Real venue name, up to 2 lines, tail-ellipsised beyond that — never
            a premature single-line cut for a normal-length name, and never a
            fabricated value. The footer is position:absolute with no fixed
            height (content-sized, anchored to `bottom`), so a wrapped 2nd
            line simply grows the footer upward over the photo — it cannot
            push the rating row off-card or collide with the top-left badge
            (badge ends ~y28; even at the smallest realistic grid cell the
            2-line name + rating row block starts well below that). Card
            itself stays a fixed square (grid symmetry preserved); only the
            text block within it grows. */}
        <Text style={styles.venueName} numberOfLines={2} ellipsizeMode="tail">{venue.name}</Text>
        {rating > 0 && (
          <View style={styles.metaRow}>
            <Icon name="star" size={10} color={CARD_STAR} />
            <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
          </View>
        )}
      </View>

      {/* Unsave — 27px glass heart, top-right. Static style + ripple only
          (NativeWind interop drops Pressable style-functions on device). */}
        <Pressable
          style={styles.unsaveBtn}
          android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: true }}
          onPress={onUnsave}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${venue.name} from favourites`}
          hitSlop={8}
        >
          <Icon name="heartFill" size={13} color={HEART_RED} />
        </Pressable>
      </TouchableOpacity>
    </View>
  );
}

// ─── FavouritesScreen ─────────────────────────────────────────────────────────
export default function FavouritesScreen() {
  const { tokens: T, mode } = useAppTheme();
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  const user         = useUser();
  const queryClient  = useQueryClient();
  const insets       = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  // Same tab-safe viewport rule as accepted Home: the scrollable area ends
  // above the tab bar, so content can never sit beneath it — the bar only
  // ever overlays the V2Background layer.
  const tabSafeZone = Math.max(tabBarHeight, 52 + insets.bottom);

  // 2-column grid cell: half the width left after the two outer gutters and
  // the single inter-card gap. Explicit size (not flex) so a lone card in a
  // row keeps its grid width instead of stretching full-bleed.
  const { width: windowWidth } = useWindowDimensions();
  const cardSize = Math.floor((windowWidth - H_PAD * 2 - CARD_GAP) / 2);

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
  const savedCount = favRows.filter((r) => r.venue !== null).length;

  // ── Header (prototype: eyebrow / title / "{n} saved", aligned flex-end) ────
  const listHeader = (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={[styles.eyebrow, { color: ACCENT.accent }]}>Saved places</Text>
        <Text style={[styles.title, { color: T.label }]} maxFontSizeMultiplier={1.2}>Your favourites</Text>
      </View>
      <Text style={[styles.savedCount, { color: T.label3 }]}>{savedCount} saved</Text>
    </View>
  );

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={styles.root}>
        <ThemedBackground />
        <StatusBar style={statusBarStyle} />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.centred}>
            <View style={[styles.iconTile, { backgroundColor: T.surface, borderColor: T.separator }]}>
              <Icon name="heartFill" size={34} color={HEART_RED} />
            </View>
            <Text style={[styles.stateTitle, { color: T.label }]}>Save your favourite places</Text>
            <Text style={[styles.stateSub, { color: T.label3 }]}>
              Sign in to keep a personal list of venues your family loves.
            </Text>
            {/* Layout-only inline style (not styles.primaryBtn) — that style
                object's backgroundColor: ACCENT.accent must NOT reach
                GlassButton via `style`, colour only ever comes from its own
                variant/active resolution (see GlassButton's own header
                comment for why). styles.primaryBtn/primaryBtnText are now
                unused but left in place — out of scope for this file per
                the Bucket B constraint (favourites.tsx button-only edit). */}
            <GlassButton
              onPress={() => router.push('/(auth)/login')}
              accessibilityLabel="Sign in to save favourites"
              label="Sign in"
              style={{ borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36, marginTop: 26 }}
            />
            <Pressable
              style={styles.secondaryBtnWrap}
              android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
              onPress={() => router.push('/(auth)/register')}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>Create an account</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.root}>
        <ThemedBackground />
        <StatusBar style={statusBarStyle} />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.centred}>
            <ActivityIndicator color={ACCENT.accent} size="large" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <View style={styles.root}>
        <ThemedBackground />
        <StatusBar style={statusBarStyle} />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.centred}>
            <Text style={styles.errorEmoji}>⚠️</Text>
            <Text style={[styles.stateTitle, { color: T.label }]}>Could not load favourites</Text>
            <Text style={[styles.stateSub, { color: T.label3 }]}>Check your connection and try again.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Signed-in grid view ───────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Same accepted v2 atmosphere as Home/Venue Detail/Plan Visit — the
          shared weather cache key + pure resolveAtmosphere() keep it
          identical across screens. Covers the tabs layout's legacy ambient
          layer exactly like Home does. */}
      <ThemedBackground />
      {/* Local override of the tabs layout's shared status bar — same
          stacking pattern as Home; mode-aware so it reads correctly on both
          the v2 dark and v2 light atmospheres. */}
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        {showEmpty ? (
          <ScrollView
            style={{ marginBottom: tabSafeZone }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.emptyScrollContent}
          >
            {listHeader}
            <SavedEmptyState />
            <View style={styles.bottomPad} />
          </ScrollView>
        ) : (
          <FlatList
            data={favRows}
            keyExtractor={(item) => item.id}
            numColumns={2}
            style={{ marginBottom: tabSafeZone }}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={listHeader}
            ListFooterComponent={<View style={styles.bottomPad} />}
            renderItem={({ item }) => (
              <FavCard
                item={item}
                size={cardSize}
                onPress={() => handlePress(item.venue_id)}
                onUnsave={() => unsaveMutation.mutate(item.id)}
              />
            )}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Transparent — V2Background (first child) is the screen's backdrop.
    backgroundColor: 'transparent',
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // ── Header (prototype: padding '52px 16px 14px', flex-end) ───────────
  header: {
    paddingTop: 6, // status bar height comes from SafeArea, like Home
    paddingBottom: 14,
    paddingHorizontal: H_PAD,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexShrink: 1,
    paddingRight: 12,
  },
  eyebrow: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    // color: mode-aware, applied inline (ACCENT.accent is not theme-flipped).
  },
  title: {
    marginTop: 2,
    fontFamily: FontFamily.display,
    fontSize: 28,
    lineHeight: 32, // 1.15
    letterSpacing: -0.5,
    // color: mode-aware, applied inline (T.label).
  },
  savedCount: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    marginBottom: 4, // optically aligns with the title baseline (flex-end row)
    // color: mode-aware, applied inline (T.label3).
  },

  // ── List layout ───────────────────────────────────────────────────
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
  bottomPad: {
    height: 32, // viewport already ends above the tab bar (tabSafeZone)
  },

  // ── Venue card (prototype: square, r18, hairline separator ring).
  // Width/height come from the computed cardSize (see FavCard) — no flex,
  // so a single saved venue keeps its grid cell instead of going full-width.
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    // borderColor / backgroundColor: mode-aware, applied inline (T.separator
    // / T.surface — the latter is the brief flash colour while a photo decodes).
  },
  // Fills the sized card wrapper — deliberately the ONLY dimension style on
  // the touchable (the plain-View wrapper owns width/height).
  cardTouch: {
    flex: 1,
  },
  typeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BADGE_GLASS,
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
    maxWidth: '70%', // never collides with the heart button
  },
  typeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  typeText: {
    fontFamily: FontFamily.caption,
    fontSize: 10,
    color: '#FFFFFF',
  },
  cardFooter: {
    position: 'absolute',
    bottom: 8,
    left: 9,
    right: 36, // clear of the heart button (prototype: right 32)
  },
  venueName: {
    fontFamily: FontFamily.caption,
    fontSize: 12.5,
    lineHeight: 15,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 10.5,
    color: CARD_STAR,
  },
  unsaveBtn: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 27,
    height: 27,
    borderRadius: 999,
    backgroundColor: HEART_GLASS,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Shared state styles (signed-out / error) ──────────────────────
  iconTile: {
    width: 80,
    height: 80,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    // backgroundColor / borderColor: mode-aware, applied inline.
  },
  stateTitle: {
    fontFamily: FontFamily.display,
    fontSize: 22,
    letterSpacing: -0.5,
    textAlign: 'center',
    // color: mode-aware, applied inline (T.label).
  },
  stateSub: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 24,
    maxWidth: 280,
    // color: mode-aware, applied inline (T.label3).
  },
  errorEmoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: ACCENT.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 36,
    marginTop: 26,
  },
  primaryBtnText: {
    fontFamily: FontFamily.caption,
    fontSize: 15.5,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  secondaryBtnWrap: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  secondaryBtnText: {
    fontFamily: FontFamily.caption,
    fontSize: 14,
    color: ACCENT.accent,
  },
});
