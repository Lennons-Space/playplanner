/**
 * My Submitted Venues screen — app/profile/my-venues.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * useMyVenues query and handleVenuePress moderation-status branching
 * (approved -> navigate, pending/rejected -> Alert, never navigate — this
 * intentionally never exposes the moderation workflow) are byte-identical
 * to the pre-restyle version.
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
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useMyVenues } from '@/hooks/useDataRights';
import { ModerationBadge } from '@/components/profile/ModerationBadge';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { V2Background } from '@/components/ui/V2Background';
import { V2Header } from '@/components/ui/V2Header';
import { Themes, FontFamily, ocean } from '@/constants/theme';
import type { ModerationStatus } from '@/types';

const T = Themes.dark;
const ACCENT = ocean;

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
    <View style={styles.root}>
      <V2Background />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <V2Header title="My Submitted Venues" />

        {/* Loading */}
        {isLoading && (
          <View style={styles.centred}>
            <ActivityIndicator color={ACCENT.accent} size="large" />
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
              <GlassSurface key={venue.id} style={styles.card} tintColor="rgba(14,14,20,0.55)">
                <TouchableOpacity
                  style={styles.cardRow}
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
              </GlassSurface>
            ))}
          </ScrollView>
        )}

      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label2,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  emptyHeading: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label2,
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: ACCENT.accent,
  },
  card: {
    borderRadius: 16,
    // Wider than the original 8px gap — with the lighter 0.55 tint above,
    // this keeps the shared animated background visible between rows even
    // when the list is long, instead of reading as one solid stacked column.
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  cardLeft: {
    flex: 1,
    marginRight: 12,
  },
  venueName: {
    fontFamily: FontFamily.heading,
    fontSize: 15,
    color: T.label,
    marginBottom: 2,
  },
  venueCity: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label3,
  },
  submittedDate: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label4,
    marginTop: 2,
  },
});
