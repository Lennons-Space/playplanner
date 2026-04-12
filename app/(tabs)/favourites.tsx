/**
 * Favourites tab — saved venues for the current user.
 *
 * RLS note:
 * The Supabase query filters by user_id client-side (.eq('user_id', user.id))
 * AND is protected server-side by RLS on the `favourites` table. The client
 * filter is belt-and-braces — RLS is the authoritative security boundary.
 * Never rely on client-side filtering alone for user-scoped data.
 *
 * Data minimisation:
 * We select only the columns VenueCard actually needs rather than selecting
 * the entire venues row. This limits data transfer and avoids accidentally
 * exposing fields like `claimed_by`, `submitted_by`, or `moderation_status`
 * to the client — even if they are not rendered, they travel over the wire.
 *
 * Query key:
 * ['favourites', user.id] matches the key used in venue/[id].tsx when it calls
 * queryClient.invalidateQueries. This ensures the list refreshes automatically
 * after the user toggles a favourite on the detail screen.
 */

import { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import VenueCard from '@/components/venue/VenueCard';
import { Colors } from '@/constants/theme';
import type { Favourite, Venue } from '@/types';

// ─── Type for the joined Supabase row ─────────────────────────────────────────
// The select query below joins the venue with its category. We express this as
// a local type so TypeScript knows the shape of `item.venue` in renderItem.
type FavouriteWithVenue = Omit<Favourite, 'venue'> & {
  venue: Pick<
    Venue,
    | 'id' | 'name' | 'slug' | 'city' | 'postcode' | 'country'
    | 'average_rating' | 'review_count' | 'is_premium' | 'is_verified'
    | 'price_range' | 'min_age' | 'max_age'
    | 'latitude' | 'longitude'
    | 'category_id' | 'category'
    // Fields required by the Venue interface that we populate with safe defaults:
    | 'is_published' | 'moderation_status' | 'review_count'
    | 'created_at' | 'updated_at'
  > & {
    category?: { id: string; name: string; icon: string; color: string; slug: string } | null;
  };
};

// ─── FavouritesScreen ─────────────────────────────────────────────────────────
export default function FavouritesScreen() {
  const user = useUser();

  const { data: favourites = [], isLoading, isError } = useQuery({
    queryKey: ['favourites', user?.id],
    queryFn: async () => {
      // Only the columns VenueCard needs — not the full venue row.
      // moderation_status and is_published are included so that if a venue is
      // later unpublished or rejected, the card can still render without crashing
      // (VenueCard doesn't check these, but they satisfy the Venue type shape).
      const { data, error } = await supabase
        .from('favourites')
        .select(`
          id,
          user_id,
          venue_id,
          list_name,
          created_at,
          venue:venues (
            id, name, slug, city, postcode, country,
            average_rating, review_count, is_premium, is_verified,
            price_range, min_age, max_age,
            latitude, longitude,
            category_id, is_published, moderation_status,
            created_at, updated_at,
            category:categories ( id, name, icon, color, slug )
          )
        `)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as FavouriteWithVenue[];
    },
    // Only run the query if the user is signed in.
    // Without this guard the query runs with user!.id throwing immediately.
    enabled: !!user,
    staleTime: 1000 * 60 * 2, // 2 min — favourites change infrequently
  });

  // Stable press handler — avoids creating a new function per FlatList render.
  // VenueCard is memoised, so stable props mean no unnecessary re-renders.
  const handleVenuePress = useCallback((id: string) => {
    router.push(`/venue/${id}`);
  }, []);

  // ── Not signed in ───────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center px-8" edges={['top']}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>💛</Text>
        <Text
          className="text-charcoal text-xl text-center"
          style={{ fontFamily: 'Nunito-ExtraBold' }}
        >
          Save your favourite places
        </Text>
        <Text
          className="text-grey text-center mt-2 mb-8"
          style={{ fontFamily: 'Nunito-Regular', fontSize: 15 }}
        >
          Sign in to keep a personal list of venues your family loves.
        </Text>
        <TouchableOpacity
          className="rounded-2xl py-4 px-8"
          style={{ backgroundColor: Colors.coral }}
          onPress={() => router.push('/(auth)/login')}
          accessibilityRole="button"
          accessibilityLabel="Sign in to save favourites"
        >
          <Text
            className="text-white text-base"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Sign in
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="mt-3 py-3"
          onPress={() => router.push('/(auth)/register')}
          accessibilityRole="button"
        >
          <Text
            className="text-coral text-sm"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Create an account
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center" edges={['top']}>
        <ActivityIndicator color={Colors.coral} size="large" />
      </SafeAreaView>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center px-8" edges={['top']}>
        <Text style={{ fontSize: 48, marginBottom: 12 }}>⚠️</Text>
        <Text
          className="text-charcoal text-lg text-center"
          style={{ fontFamily: 'Nunito-Bold' }}
        >
          Could not load favourites
        </Text>
        <Text
          className="text-grey text-sm text-center mt-2"
          style={{ fontFamily: 'Nunito-Regular' }}
        >
          Check your connection and try again.
        </Text>
      </SafeAreaView>
    );
  }

  // ── Signed-in list view ─────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      <View className="px-4 pt-4 pb-2">
        <Text
          className="text-2xl text-charcoal"
          style={{ fontFamily: 'Nunito-ExtraBold' }}
        >
          Favourites
        </Text>
        {favourites.length > 0 && (
          <Text
            className="text-grey text-sm mt-1"
            style={{ fontFamily: 'Nunito-Regular' }}
          >
            {favourites.length} saved {favourites.length === 1 ? 'venue' : 'venues'}
          </Text>
        )}
      </View>

      <FlatList
        data={favourites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
        ListEmptyComponent={
          <View className="items-center mt-20">
            <Text style={{ fontSize: 56, marginBottom: 12 }}>💛</Text>
            <Text
              className="text-charcoal text-lg text-center"
              style={{ fontFamily: 'Nunito-Bold' }}
            >
              No favourites yet
            </Text>
            <Text
              className="text-grey text-sm text-center mt-2"
              style={{ fontFamily: 'Nunito-Regular' }}
            >
              Tap the heart on any venue to save it here.
            </Text>
          </View>
        }
        renderItem={({ item }: { item: FavouriteWithVenue }) => {
          // item.venue could theoretically be null if the venue was deleted
          // after it was favourited (referential integrity should prevent this,
          // but we guard defensively to avoid a crash).
          if (!item.venue) return null;

          return (
            <VenueCard
              venue={item.venue as Venue}
              onPress={() => handleVenuePress(item.venue_id)}
            />
          );
        }}
      />
    </SafeAreaView>
  );
}
