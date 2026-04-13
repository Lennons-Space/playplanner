/**
 * ReviewForm.tsx
 * The form a parent fills in to rate and review a venue.
 *
 * Privacy notes:
 * - We collect: rating, optional title, body text, optional visit date.
 * - We do NOT collect location, exact dates of birth, device identifiers,
 *   or any data beyond what is necessary for the review itself.
 * - The user's display name is stored in their profile — we do not re-ask for
 *   it here. We tell the user their display name will appear so they can
 *   adjust their privacy settings if they want anonymity.
 * - Visit date is kept to the year-month level (YYYY-MM-DD) and is optional.
 *   This is sufficient for helpfulness ("visited last summer") without creating
 *   a precise location-and-time record of the family's movements.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSubmitReview } from '@/hooks/useReviews';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BODY_MIN   = 10;
const BODY_MAX   = 500;   // 500 chars: data minimisation + easier moderation for a family app
const TITLE_MAX  = 100;

// Regex for YYYY-MM-DD format — validates structure before parsing as a Date
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewFormProps {
  venueId: string;
  venueName: string;
  /** Called after the review is successfully submitted — typically navigates away */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * StarSelector — five tappable stars.
 * Renders coral for selected stars, greyLighter for unselected.
 * Tapping a star sets the rating to that number (1–5).
 */
function StarSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onChange(n)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityLabel={`Rate ${n} star${n !== 1 ? 's' : ''}`}
          accessibilityRole="button"
        >
          <Text style={[styles.star, n <= value ? styles.starFilled : styles.starEmpty]}>
            {n <= value ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns an error string if visitDate is provided but invalid/in the future.
 * Returns null if the value is empty (visit date is optional) or valid.
 */
function validateVisitDate(value: string): string | null {
  if (!value.trim()) return null;   // empty is fine — field is optional

  if (!DATE_REGEX.test(value.trim())) {
    return 'Please use the format YYYY-MM-DD (e.g. 2026-03-15)';
  }

  const parsed = new Date(value.trim());
  if (isNaN(parsed.getTime())) {
    return 'That does not look like a valid date';
  }

  // Reviews must be for visits that have already happened
  const today = new Date();
  today.setHours(23, 59, 59, 999);  // allow today — visit could be today
  if (parsed > today) {
    return 'Visit date cannot be in the future';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewForm({ venueId, venueName, onSuccess }: ReviewFormProps) {
  const [rating, setRating]         = useState(0);
  const [title, setTitle]           = useState('');
  const [body, setBody]             = useState('');
  const [visitDate, setVisitDate]   = useState('');

  // Inline validation error messages — shown below the relevant field
  const [ratingError, setRatingError]       = useState('');
  const [bodyError, setBodyError]           = useState('');
  const [visitDateError, setVisitDateError] = useState('');

  const submitMutation = useSubmitReview();
  const isSubmitting   = submitMutation.isPending;

  // -------------------------------------------------------------------------

  async function handleSubmit() {
    // Reset all field errors before re-validating
    setRatingError('');
    setBodyError('');
    setVisitDateError('');

    let hasError = false;

    // 1. Rating is required
    if (rating < 1 || rating > 5) {
      setRatingError('Please select a star rating before submitting');
      hasError = true;
    }

    // 2. Body is required and has length bounds
    const trimmedBody = body.trim();
    if (trimmedBody.length < BODY_MIN) {
      setBodyError(`Your review must be at least ${BODY_MIN} characters`);
      hasError = true;
    } else if (trimmedBody.length > BODY_MAX) {
      setBodyError(`Your review must be ${BODY_MAX} characters or fewer`);
      hasError = true;
    }

    // 3. Title length (optional field, but if provided must be within limit)
    if (title.trim().length > TITLE_MAX) {
      // No separate error state for title — show via Alert as it's a soft limit
      Alert.alert('Title too long', `Your title must be ${TITLE_MAX} characters or fewer.`);
      hasError = true;
    }

    // 4. Visit date format + not in the future (optional field)
    const dateError = validateVisitDate(visitDate);
    if (dateError) {
      setVisitDateError(dateError);
      hasError = true;
    }

    if (hasError) return;

    // All validation passed — submit
    submitMutation.mutate(
      {
        venueId,
        rating,
        title:        title.trim(),
        body:         trimmedBody,
        visitDate:    visitDate.trim() || null,
        childrenAges: [],   // future enhancement — not collected in this version
      },
      {
        onSuccess: () => {
          Alert.alert(
            'Review submitted!',
            'Your review will appear once our team has checked it. This usually takes 24–48 hours.',
            [{ text: 'Great!', onPress: onSuccess }]
          );
        },
        onError: (err) => {
          const message = err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.';
          Alert.alert('Submission failed', message);
        },
      }
    );
  }

  // -------------------------------------------------------------------------

  return (
    <SafeAreaView className="flex-1 bg-slate">
      <ScrollView className="px-4" keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-2">
          <Text className="text-2xl font-extrabold text-charcoal">Write a review</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-grey text-base">Cancel</Text>
          </TouchableOpacity>
        </View>

        {venueName ? (
          <Text className="text-grey mb-6">Reviewing {venueName}</Text>
        ) : null}

        <View style={styles.fields}>

          {/* --- Star rating --- */}
          <View>
            <Text className="text-charcoal font-bold mb-2">Your rating *</Text>
            <StarSelector value={rating} onChange={setRating} />
            {ratingError ? (
              <Text style={styles.fieldError}>{ratingError}</Text>
            ) : null}
          </View>

          {/* --- Title (optional) --- */}
          <View>
            <Text className="text-charcoal font-bold mb-1">
              Title <Text className="text-grey font-normal">(optional)</Text>
            </Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={title}
              onChangeText={setTitle}
              placeholder="Sum up your visit in a few words"
              maxLength={TITLE_MAX}
              returnKeyType="next"
            />
          </View>

          {/* --- Body (required) --- */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Your review *</Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={body}
              onChangeText={setBody}
              placeholder="Tell other parents what it was like — facilities, parking, value for money..."
              multiline
              numberOfLines={5}
              maxLength={BODY_MAX}
              // Vertically aligned text for multiline inputs on both platforms
              textAlignVertical="top"
              style={styles.bodyInput}
            />
            {/* Character counter — helpful but not required */}
            <Text style={styles.charCount}>
              {body.length}/{BODY_MAX}
            </Text>
            {bodyError ? (
              <Text style={styles.fieldError}>{bodyError}</Text>
            ) : null}
          </View>

          {/* --- Visit date (optional) --- */}
          <View>
            <Text className="text-charcoal font-bold mb-1">
              Visit date <Text className="text-grey font-normal">(optional)</Text>
            </Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={visitDate}
              onChangeText={setVisitDate}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              returnKeyType="done"
            />
            {visitDateError ? (
              <Text style={styles.fieldError}>{visitDateError}</Text>
            ) : null}
          </View>

          {/* Privacy disclosure — GDPR Art.13 transparency */}
          <Text style={styles.privacyNote}>
            Your display name will be shown alongside your review. You can change your
            privacy settings in your profile if you prefer to appear as Anonymous.
          </Text>

          {/* Submit button */}
          <TouchableOpacity
            className="bg-sky rounded-2xl py-4 items-center mt-2 mb-10"
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? <ActivityIndicator color="#fff" />
              : <Text className="text-white font-bold text-lg">Submit review</Text>
            }
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles (only for values that need precise numbers or aren't expressible as
// NativeWind classes — e.g. multiline input height, star size)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fields: {
    gap: 16,
  },
  starRow: {
    flexDirection: 'row',
    gap: 8,
  },
  star: {
    fontSize: 36,
  },
  starFilled: {
    color: '#FF6B6B',   // coral
  },
  starEmpty: {
    color: '#DFE6E9',   // greyLighter
  },
  bodyInput: {
    minHeight: 120,
  },
  charCount: {
    fontSize: 11,
    color: '#636E72',   // grey
    textAlign: 'right',
    marginTop: 4,
  },
  fieldError: {
    fontSize: 13,
    color: '#D63031',   // error
    marginTop: 4,
  },
  privacyNote: {
    fontSize: 12,
    color: '#636E72',   // grey
    lineHeight: 18,
  },
});
