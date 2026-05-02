/**
 * ReviewForm.tsx
 * Three-step review flow for parents rating a UK children's venue.
 *
 * Privacy notes:
 * - We collect: rating, optional tags, body text. Visit date is NOT shown in
 *   the main flow UI but validateVisitDate is kept for potential future use.
 * - Review body and tags are NEVER logged — they may contain personal information
 *   the parent has written about their children or family.
 * - Anonymous toggle: hides the display name on the review card. Children's
 *   names are never stored regardless.
 * - Data minimisation: tags sent as null (not []) when none selected.
 *
 * Step flow:
 *   Step 1 — Rate your visit (star rating)
 *   Step 2 — Tell other parents (tags + body + anonymous toggle)
 *   Step 3 — Thanks! (success preview card)
 */

import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSubmitReview } from '@/hooks/useReviews';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui';

// ---------------------------------------------------------------------------
// Design tokens — PlayPlanner palette (inline StyleSheet, no NativeWind)
// ---------------------------------------------------------------------------

const PP = {
  ink:       '#1D2630',
  inkSoft:   '#4A5560',
  mute:      '#7B8794',
  line:      '#E6E2DB',
  lineSoft:  '#F1ECE2',
  sand:      '#FBF6EC',
  paper:     '#FFFFFF',
  sky:       '#2FB8B0',
  skyDeep:   '#1B8A85',
  skyWash:   '#EEF9F8',
  coral:     '#FF6B6B',
  coralSoft: '#FFE2DE',
  star:      '#F5A524',
  leaf:      '#5BC08A',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BODY_MIN  = 10;
const BODY_MAX  = 500;   // data minimisation + easier moderation

// Regex for YYYY-MM-DD format — kept for potential future use
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const TAG_LIST = [
  { id: 'pram-friendly',   label: 'Pram friendly' },
  { id: 'clean-toilets',   label: 'Clean toilets' },
  { id: 'baby-changing',   label: 'Baby changing' },
  { id: 'great-toddlers',  label: 'Great for toddlers' },
  { id: 'older-kids',      label: 'Good for older kids' },
  { id: 'friendly-staff',  label: 'Friendly staff' },
  { id: 'good-value',      label: 'Good value' },
  { id: 'easy-parking',    label: 'Easy parking' },
  { id: 'cafe-on-site',    label: 'Café on site' },
];

const RATING_COPY = [
  'How was it?',
  'Not great',
  'A bit meh',
  'It was alright',
  'Really good',
  'Absolute gem',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewFormProps {
  venueId: string;
  venueName: string;
  /**
   * UUID of the user who has claimed this venue, if any.
   * Belt-and-braces own-venue guard — primary enforcement is DB RLS + hook.
   */
  venueClaimedBy?: string | null;
  /**
   * UUID of the user who originally submitted this venue, if any.
   * Same belt-and-braces purpose as venueClaimedBy.
   */
  venueSubmittedBy?: string | null;
  /** Called after the success step's "Back to venue" button is pressed. */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns an error string if visitDate is provided but invalid/in the future.
 * Returns null if the value is empty (field is optional) or valid.
 * Kept here even though the field is not shown in the current UI so that
 * any future caller has a validated helper ready.
 */
function validateVisitDate(value: string): string | null {
  if (!value.trim()) return null;

  if (!DATE_REGEX.test(value.trim())) {
    return 'Please use the format YYYY-MM-DD (e.g. 2026-03-15)';
  }

  const parsed = new Date(value.trim());
  if (isNaN(parsed.getTime())) {
    return 'That does not look like a valid date';
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (parsed > today) {
    return 'Visit date cannot be in the future';
  }

  return null;
}

// ---------------------------------------------------------------------------
// FlowHeader sub-component
// ---------------------------------------------------------------------------

function FlowHeader({
  step,
  total,
  title,
  onBack,
  onClose,
}: {
  step: number;
  total: number;
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="chevL" size={18} color={PP.ink} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.stepLabel}>STEP {step} OF {total}</Text>
          <Text style={styles.stepTitle}>{title}</Text>
        </View>

        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="close" size={18} color={PP.ink} />
        </TouchableOpacity>
      </View>

      {/* Progress bar — filled segments indicate completed steps */}
      <View style={styles.progressRow}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.progressSeg,
              { backgroundColor: i < step ? PP.sky : PP.lineSoft },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FlowFooter sub-component
// ---------------------------------------------------------------------------

function FlowFooter({
  primary,
  onPrimary,
  secondary,
  onSecondary,
  disabled,
}: {
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.footer}>
      {secondary && (
        <TouchableOpacity
          onPress={onSecondary}
          style={styles.footerSecondary}
          accessibilityRole="button"
        >
          <Text style={styles.footerSecondaryText}>{secondary}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={disabled ? undefined : onPrimary}
        style={[styles.footerPrimary, disabled && styles.footerPrimaryDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
      >
        <Text
          style={[
            styles.footerPrimaryText,
            disabled && styles.footerPrimaryTextDisabled,
          ]}
        >
          {primary}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewForm({
  venueId,
  venueName,
  venueClaimedBy,
  venueSubmittedBy,
  onSuccess,
}: ReviewFormProps) {
  const [step, setStep]             = useState<1 | 2 | 3>(1);
  const [rating, setRating]         = useState(0);
  const [tags, setTags]             = useState<Record<string, boolean>>({});
  const [body, setBody]             = useState('');
  const [anonymous, setAnonymous]   = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);

  const [ratingError, setRatingError]   = useState('');
  const [bodyMinError, setBodyMinError] = useState('');

  const trimmedBodyLength = body.trim().length;
  const bodyOverLimit     = trimmedBodyLength > BODY_MAX;
  const bodyError         = bodyOverLimit
    ? `Your review must be ${BODY_MAX} characters or fewer`
    : bodyMinError;

  const submitMutation = useSubmitReview();
  const isSubmitting   = submitMutation.isPending;
  // submitLocked prevents a rapid double-tap from firing two network requests
  // before isPending becomes true on the first re-render after mutate().
  const submitLocked = useRef(false);

  const activeTags = TAG_LIST.filter((t) => tags[t.id]);

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  function handleBack() {
    if (step === 1) router.back();
    else setStep((s) => (s - 1) as 1 | 2 | 3);
  }

  function handleClose() {
    router.back();
  }

  // -------------------------------------------------------------------------
  // Step 1 — proceed to Step 2 after rating is set
  // -------------------------------------------------------------------------

  function handleNextStep1() {
    if (rating === 0) {
      setRatingError('Please select a rating');
      return;
    }
    setRatingError('');
    setStep(2);
  }

  // -------------------------------------------------------------------------
  // Step 2 — submit review
  // -------------------------------------------------------------------------

  async function handleSubmit() {
    if (submitLocked.current || isSubmitting) return;
    submitLocked.current = true;
    setBodyMinError('');

    const trimmedBody = body.trim();
    if (trimmedBody.length < BODY_MIN) {
      setBodyMinError(`Please write at least ${BODY_MIN} characters`);
      submitLocked.current = false;
      return;
    }

    submitMutation.mutate(
      {
        venueId,
        venueClaimedBy,
        venueSubmittedBy,
        rating,
        // Tags become the review title — a quick summary for the card header.
        // review body and tags are NEVER logged (may contain personal info).
        title: activeTags.map((t) => t.label).join(', ') || '',
        body: trimmedBody,
        visitDate: null,
        childrenAges: [],
        tags: activeTags.map((t) => t.id),
        // Wire the anonymous toggle state through to the hook so it is
        // persisted in the DB (migration 038). Without this the DB always
        // received is_anonymous=false, making the toggle a false privacy promise.
        anonymous,
      },
      {
        onSuccess: () => {
          submitLocked.current = false;
          setStep(3); // show success step — onSuccess is called from Step 3 CTA
        },
        onError: (err) => {
          submitLocked.current = false;
          const message =
            err instanceof Error
              ? err.message
              : 'Something went wrong. Please try again.';
          Alert.alert('Submission failed', message);
        },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const stepTitles = ['Rate your visit', 'Tell other parents', 'Thanks!'];

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlowHeader
          step={step}
          total={3}
          title={stepTitles[step - 1]}
          onBack={handleBack}
          onClose={handleClose}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ----------------------------------------------------------------
              STEP 1 — Star rating
          ---------------------------------------------------------------- */}
          {step === 1 && (
            <View>
              {/* Venue mini card */}
              <View style={styles.venueMiniCard}>
                <View style={styles.venueMiniIcon}>
                  <Icon name="map" size={20} color={PP.sky} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.venueMiniName}>{venueName}</Text>
                  <Text style={styles.venueMiniLabel}>Write a review</Text>
                </View>
                <View style={styles.venueMiniPill}>
                  <Text style={styles.venueMiniPillText}>REVIEW</Text>
                </View>
              </View>

              {/* Rating block */}
              <View style={styles.ratingBlock}>
                <Text style={styles.ratingCopy}>{RATING_COPY[rating]}</Text>
                {rating === 0 && (
                  <Text style={styles.ratingHint}>Tap a star</Text>
                )}

                {/* Stars row */}
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setRating(n)}
                      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Rate ${n} star${n !== 1 ? 's' : ''}`}
                    >
                      <Icon
                        name={rating >= n ? 'star' : 'starLine'}
                        size={46}
                        color={rating >= n ? PP.star : PP.line}
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                {ratingError ? (
                  <Text style={styles.fieldError}>{ratingError}</Text>
                ) : null}
              </View>

              {/* Trust note — GDPR Art.13 transparency */}
              <View style={styles.trustNote}>
                <Icon name="shield" size={16} color={PP.mute} />
                <Text style={styles.trustNoteText}>
                  Honest reviews help other parents. We remove anything with
                  identifying details about children.
                </Text>
              </View>
            </View>
          )}

          {/* ----------------------------------------------------------------
              STEP 2 — Tags + body + anonymous toggle
          ---------------------------------------------------------------- */}
          {step === 2 && (
            <View>
              {/* Tags */}
              <Text style={styles.fieldLabel}>What stood out?</Text>
              <View style={styles.tagRow}>
                {TAG_LIST.map((tag) => {
                  const selected = !!tags[tag.id];
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      onPress={() =>
                        setTags((prev) => ({
                          ...prev,
                          [tag.id]: !prev[tag.id],
                        }))
                      }
                      style={[
                        styles.tagChip,
                        selected ? styles.tagChipSelected : styles.tagChipUnselected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={tag.label}
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[
                          styles.tagChipText,
                          selected
                            ? styles.tagChipTextSelected
                            : styles.tagChipTextUnselected,
                        ]}
                      >
                        {tag.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Body */}
              <Text style={styles.fieldLabel}>
                Your review <Text style={{ color: PP.coral }}>*</Text>
              </Text>
              <View
                style={[
                  styles.bodyContainer,
                  (bodyFocused || body.length > 0) && styles.bodyContainerFocused,
                ]}
              >
                <TextInput
                  style={styles.bodyInput}
                  value={body}
                  onChangeText={setBody}
                  onFocus={() => setBodyFocused(true)}
                  onBlur={() => setBodyFocused(false)}
                  multiline
                  numberOfLines={5}
                  autoFocus
                  textAlignVertical="top"
                  maxLength={BODY_MAX}
                  placeholder="What would you tell another parent? Parking? Facilities? Age suitability?"
                  placeholderTextColor={PP.mute}
                />
              </View>

              {/* Char counter */}
              <View style={styles.charCountRow}>
                <Text
                  style={[
                    styles.charCount,
                    body.length >= BODY_MAX && styles.charCountOver,
                  ]}
                  testID="char-counter"
                >
                  {body.length}/{BODY_MAX}
                </Text>
              </View>

              {bodyError ? (
                <Text style={styles.fieldError}>{bodyError}</Text>
              ) : null}

              {/* Anonymous toggle */}
              <TouchableOpacity
                onPress={() => setAnonymous((a) => !a)}
                style={styles.anonRow}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: anonymous }}
              >
                <View
                  style={[
                    styles.checkbox,
                    anonymous && styles.checkboxChecked,
                  ]}
                >
                  {anonymous && (
                    <Icon name="check" size={12} color="#fff" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.anonTitle}>Post anonymously</Text>
                  <Text style={styles.anonSub}>
                    Your name is hidden; kids' names always are.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* ----------------------------------------------------------------
              STEP 3 — Success
          ---------------------------------------------------------------- */}
          {step === 3 && (
            <View style={styles.successWrap}>
              {/* Hero circles */}
              <View style={styles.heroouter}>
                <View style={styles.heroInner}>
                  <Icon name="heartFill" size={30} color="#fff" />
                </View>
              </View>

              <Text style={styles.successHeading} testID="success-heading">Thanks!</Text>
              <Text style={styles.successSub}>
                Your review is with our team. It usually goes live within 24 hours.
              </Text>

              {/* Preview card */}
              <View style={styles.previewCard}>
                <View style={styles.previewHeader}>
                  {/* Avatar */}
                  <View style={styles.previewAvatar}>
                    <Text style={styles.previewAvatarText}>
                      {anonymous ? '?' : 'Y'}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewName}>
                      {anonymous ? 'Anonymous parent' : 'You'}
                    </Text>
                    <Text style={styles.previewTime}>Just now</Text>
                  </View>

                  <Stars rating={rating} size={12} />
                </View>

                {/* Body preview — truncated, no logging */}
                {body.trim().length > 0 && (
                  <Text style={styles.previewBody}>
                    &quot;
                    {body.trim().length > 120
                      ? `${body.trim().slice(0, 120)}...`
                      : body.trim()}
                    &quot;
                  </Text>
                )}

                {/* Tag pills */}
                {activeTags.length > 0 && (
                  <View style={styles.previewTagRow}>
                    {activeTags.map((t) => (
                      <View key={t.id} style={styles.previewTag}>
                        <Text style={styles.previewTagText}>{t.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Footer CTAs */}
        {step === 1 && (
          <FlowFooter
            primary="Next"
            onPrimary={handleNextStep1}
            disabled={rating === 0}
          />
        )}
        {step === 2 && (
          <FlowFooter
            primary={isSubmitting ? 'Posting...' : 'Post review'}
            onPrimary={handleSubmit}
            secondary="Back"
            onSecondary={() => setStep(1)}
            disabled={
              isSubmitting ||
              body.trim().length < BODY_MIN ||
              body.trim().length > BODY_MAX
            }
          />
        )}
        {step === 3 && (
          <FlowFooter primary="Back to venue" onPrimary={onSuccess} />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Layout
  root: {
    flex: 1,
    backgroundColor: PP.sand,
  },

  // Header
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
  },
  stepLabel: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: PP.mute,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 22,
    color: PP.ink,
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSeg: {
    flex: 1,
    height: 4,
    borderRadius: 999,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120, // clears the absolute-positioned footer
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: 'transparent',
  },
  footerPrimary: {
    flex: 1.4,
    backgroundColor: PP.ink,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  footerPrimaryDisabled: {
    backgroundColor: PP.line,
  },
  footerPrimaryText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: '#fff',
  },
  footerPrimaryTextDisabled: {
    color: PP.mute,
  },
  footerSecondary: {
    flex: 1,
    backgroundColor: PP.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: PP.line,
    paddingVertical: 14,
    alignItems: 'center',
  },
  footerSecondaryText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: PP.ink,
  },

  // Step 1 — venue mini card
  venueMiniCard: {
    backgroundColor: PP.paper,
    borderWidth: 1,
    borderColor: PP.line,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  venueMiniIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: PP.skyWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  venueMiniName: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: PP.ink,
  },
  venueMiniLabel: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 11,
    color: PP.mute,
  },
  venueMiniPill: {
    backgroundColor: PP.skyWash,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  venueMiniPillText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 10,
    color: PP.skyDeep,
  },

  // Step 1 — rating
  ratingBlock: {
    paddingTop: 30,
    paddingBottom: 10,
    alignItems: 'center',
  },
  ratingCopy: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: PP.ink,
    textAlign: 'center',
  },
  ratingHint: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: PP.mute,
    marginTop: 4,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },

  // Step 1 — trust note
  trustNote: {
    marginTop: 24,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PP.line,
    backgroundColor: PP.sand,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  trustNoteText: {
    flex: 1,
    fontFamily: 'Nunito-SemiBold',
    fontSize: 12,
    color: PP.inkSoft,
    lineHeight: 18,
  },

  // Step 2 — shared label
  fieldLabel: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: PP.inkSoft,
    marginBottom: 10,
  },

  // Step 2 — tags
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  tagChip: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChipSelected: {
    backgroundColor: PP.ink,
    borderColor: PP.ink,
  },
  tagChipUnselected: {
    backgroundColor: PP.paper,
    borderColor: PP.line,
  },
  tagChipText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
  },
  tagChipTextSelected: {
    color: '#fff',
  },
  tagChipTextUnselected: {
    color: PP.ink,
  },

  // Step 2 — body
  bodyContainer: {
    backgroundColor: PP.paper,
    borderWidth: 1.5,
    borderColor: PP.line,
    borderRadius: 12,
    padding: 14,
    minHeight: 110,
  },
  bodyContainerFocused: {
    borderColor: PP.ink,
  },
  bodyInput: {
    flex: 1,
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: PP.ink,
    lineHeight: 21,
    textAlignVertical: 'top',
    minHeight: 82, // inner height within the padded container
  },
  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  charCount: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 11,
    color: PP.mute,
  },
  charCountOver: {
    color: PP.coral,
  },

  // Step 2 — anonymous toggle
  anonRow: {
    marginTop: 14,
    backgroundColor: PP.paper,
    borderWidth: 1,
    borderColor: PP.line,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    minHeight: 48,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PP.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    backgroundColor: PP.ink,
    borderColor: PP.ink,
  },
  anonTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: PP.ink,
  },
  anonSub: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 11,
    color: PP.mute,
    marginTop: 2,
  },

  // Step 3 — success
  successWrap: {
    alignItems: 'center',
    paddingTop: 24,
  },
  heroouter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PP.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PP.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successHeading: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 24,
    color: PP.ink,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  successSub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: PP.inkSoft,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
  },
  previewCard: {
    backgroundColor: PP.paper,
    borderWidth: 1,
    borderColor: PP.line,
    borderRadius: 16,
    padding: 16,
    marginTop: 24,
    marginBottom: 16,
    width: '100%',
  },
  previewHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  previewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PP.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAvatarText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: '#fff',
  },
  previewName: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: PP.ink,
  },
  previewTime: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 11,
    color: PP.mute,
  },
  previewBody: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: PP.inkSoft,
    lineHeight: 19.5,
    marginTop: 10,
  },
  previewTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  previewTag: {
    backgroundColor: PP.skyWash,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  previewTagText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 10,
    color: PP.skyDeep,
  },

  // Shared error text
  fieldError: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: '#D63031',
    marginTop: 6,
  },
});
