/**
 * My Submitted Venues screen — app/profile/my-venues.tsx
 *
 * Shows all venues the user has submitted for review.
 * Approved venues link to the venue detail page.
 * Pending and rejected venues show an Alert with status information —
 * never navigate, as that could expose a moderation workflow detail.
 */
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useMyVenues } from '@/hooks/useDataRights';
import { ModerationBadge } from '@/components/profile/ModerationBadge';
import type { ModerationStatus } from '@/types';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MyVenuesScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: venues, isLoading, isError } = useMyVenues(userId);

  function handleVenuePress(id: string, status: ModerationStatus) {
    if (status === 'approved') {
      router.push('/venue/' + id);
    } else if (status === 'pending') {
      Alert.alert('Still in review', 'This venue is pending review by our team.');
    } else {
      Alert.alert(
        'Not approved',
        'This venue was not approved. Please contact support if you have questions.',
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'My Submitted Venues' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>

        {/* Loading */}
        {isLoading && (
          <View style={styles.centred}>
            <ActivityIndicator color="#FF6B6B" size="large" />
          </View>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <View style={styles.centred}>
            <Text style={styles.errorText}>
              Could not load your submitted venues. Please check your connection and try again.
            </Text>
          </View>
        )}

        {/* Content */}
        {!isLoading && !isError && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Empty state */}
            {(!venues || venues.length === 0) && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyHeading}>
                  You haven&apos;t submitted any venues yet.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/venue/add')}
                  accessibilityRole="link"
                  accessibilityLabel="Submit a venue"
                >
                  <Text style={styles.emptyLink}>Submit a venue →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Venue rows */}
            {venues && venues.map((venue: any) => (
              <TouchableOpacity
                key={venue.id}
                style={styles.card}
                onPress={() => handleVenuePress(venue.id, venue.moderation_status)}
                accessibilityRole="button"
                accessibilityLabel={`${venue.name}, ${venue.moderation_status}`}
              >
                {/* Left: name, city, date */}
                <View style={styles.cardLeft}>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <Text style={styles.venueCity}>{venue.city}</Text>
                  <Text style={styles.submittedDate}>
                    {format(new Date(venue.created_at), 'd MMM yyyy')}
                  </Text>
                </View>

                {/* Right: badge */}
                <ModerationBadge status={venue.moderation_status} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

      </SafeAreaView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF9F0',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  emptyHeading: {
    fontFamily: 'Nunito-Medium',
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#FF6B6B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardLeft: {
    flex: 1,
    marginRight: 12,
  },
  venueName: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#2D3436',
    marginBottom: 2,
  },
  venueCity: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#636E72',
  },
  submittedDate: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#B2BEC3',
    marginTop: 2,
  },
});
