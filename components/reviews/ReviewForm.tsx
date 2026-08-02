/**
 * ReviewForm.tsx
 * Three-step review flow for parents rating a UK children's venue.
 *
 * Privacy notes:
 * - We collect: rating, optional tags, body text.
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
 *
 * v2 dark restyle (Step 9, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * rating ladder, tag list, body validation (min/max), the "Post anonymously"
 * copy and default (false), submitLocked double-tap guard, and the
 * handleSubmit payload shape are byte-identical to the pre-restyle version —
 * only the JSX/styling changed. <V2Background/> is mounted per the frozen
 * background architecture behind a transparent root; FlowHeader is the one
 * deliberate header for this component (restyled dark, not duplicated
 * elsewhere); FlowFooter stays absolute and safe-area-aware.
 *
 * Phase 6 (Android keyboard/input fix, UI Trust & Reliability Repair Sprint):
 * the step-2 body field no longer uses native `autoFocus` (replaced with an
 * imperative `.focus()` triggered by that step's own onLayout event, not a
 * guessed timer — see the comments above ReviewForm's return statement) and
 * the ScrollView's footer clearance is now computed from FlowFooter's own
 * sizing formula instead of a flat guess. The outer SafeAreaView is
 * edges=['top'] only, so FlowFooter's own insets.bottom read is the single
 * source of truth for the bottom safe-area inset (previously double-counted).
 * All step content, validation, and submit behaviour are unchanged — see the
 * root-cause comments inline for why the focus timing was the suspected bug.
 */

import { useState, useRef, useMemo, useEffect } from 'react';
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
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSubmitReview } from '@/hooks/useReviews';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassButton } from '@/components/ui/GlassButton';
import { FontFamily, ocean, type ThemeTokens } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

// ---------------------------------------------------------------------------
// Design tokens — v2 palette (inline StyleSheet, no NativeWind), resolved
// per-render via useAppTheme() inside ReviewForm below (createPP(T) mirrors
// the pattern used by app/venue/plan-visit.tsx's createPP).
// ---------------------------------------------------------------------------

const ACCENT = ocean;
// Single destructive/error red used across the v2 screens (matches the
// "Weak" password-strength colour already shipped on app/(auth)/register.tsx).
const ERROR_RED = '#FF3B30';

function createPP(T: ThemeTokens) {
  return {
    ink:      T.label,
    inkSoft:  T.label2,
    mute:     T.label3,
    line:     T.separator,
    lineSoft: T.fill,
    paper:    T.surface,
    bg:       T.bg,
    sky:      ACCENT.accent,
    skyWash:  ACCENT.light,
    skyText:  ACCENT.tagText,
    // Amber rating stars — same value used on ReviewCard / venue detail.
    star:     '#F5A524',
    error:    ERROR_RED,
  };
}
type PPType = ReturnType<typeof createPP>;
type Styles = ReturnType<typeof createStyles>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BODY_MIN  = 10;
const BODY_MAX  = 500;   // data minimisation + easier moderation

// ---------------------------------------------------------------------------
// Phase 6 (Android keyboard/input fix, UI Trust & Reliability Repair Sprint):
// footer scroll-clearance constants.
//
// Root-cause note: the ScrollView's contentContainerStyle previously used a
// flat `paddingBottom: 120` GUESS to keep content clear of the absolutely-
// positioned FlowFooter. That guess doesn't account for the safe-area inset
// FlowFooter itself adds (`Math.max(28, insets.bottom + 12)`), so on devices/
// gesture-nav configurations with a larger bottom inset than assumed, the
// footer can end up taller than the guessed clearance — covering the last
// few pixels of step 2 (the body field / anonymous toggle) once the keyboard
// has also shrunk the visible viewport. Instead of guessing, we compute the
// same formula FlowFooter uses for its own height, matching the deterministic
// (non-measured) approach already established in this app at
// app/profile/edit.tsx's SAVE_BAR_* constants (Phase 5C), rather than an
// onLayout-based measurement that would race with mount timing.
const FOOTER_TOP_PADDING   = 12; // styles.footer.paddingTop
const FOOTER_BUTTON_HEIGHT = 50; // GlassButton's rendered height with footerPrimaryLayout's paddingVertical:14 (14*2 + text line height + border)
const FOOTER_SCROLL_GAP    = 16; // breathing room between the last field and the footer

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
// FlowHeader sub-component — the one deliberate header for this form
// ---------------------------------------------------------------------------

function FlowHeader({
  step,
  total,
  title,
  onBack,
  onClose,
  styles,
  PP,
}: {
  step: number;
  total: number;
  title: string;
  onBack: () => void;
  onClose: () => void;
  styles: Styles;
  PP: PPType;
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
          <Text style={styles.stepLabel} maxFontSizeMultiplier={1.3}>STEP {step} OF {total}</Text>
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
// FlowFooter sub-component — absolute, safe-area-aware
// ---------------------------------------------------------------------------

function FlowFooter({
  primary,
  onPrimary,
  secondary,
  onSecondary,
  disabled,
  styles,
  tintColor,
}: {
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
  disabled?: boolean;
  styles: Styles;
  tintColor: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <GlassSurface
      style={[styles.footer, { paddingBottom: Math.max(28, insets.bottom + 12) }]}
      tintColor={tintColor}
    >
      {secondary && (
        <TouchableOpacity
          onPress={onSecondary}
          style={styles.footerSecondary}
          accessibilityRole="button"
        >
          <Text style={styles.footerSecondaryText}>{secondary}</Text>
        </TouchableOpacity>
      )}
      <GlassButton
        onPress={onPrimary}
        disabled={!!disabled}
        accessibilityState={{ disabled: !!disabled }}
        label={primary}
        style={styles.footerPrimaryLayout}
      />
    </GlassSurface>
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
  const { tokens: T, mode } = useAppTheme();
  const PP = useMemo(() => createPP(T), [T]);
  const styles = useMemo(() => createStyles(PP), [PP]);
  const footerTint = mode === 'dark' ? 'rgba(12,12,17,0.9)' : 'rgba(255,255,255,0.9)';
  const insets = useSafeAreaInsets();
  const [step, setStep]             = useState<1 | 2 | 3>(1);
  const [rating, setRating]         = useState(0);
  const [tags, setTags]             = useState<Record<string, boolean>>({});
  const [body, setBody]             = useState('');
  const [anonymous, setAnonymous]   = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);

  const [ratingError, setRatingError]   = useState('');
  const [bodyMinError, setBodyMinError] = useState('');

  // -------------------------------------------------------------------------
  // Phase 6 — Android keyboard/input visibility (step 2's body field)
  // -------------------------------------------------------------------------
  //
  // Root cause: the body TextInput previously used the native `autoFocus`
  // prop, which requests focus (and therefore opens the keyboard)
  // SYNCHRONOUSLY on mount — i.e. the instant the step-2 JSX first renders,
  // while this screen is still mid-navigation-transition and the
  // KeyboardAvoidingView/ScrollView have not finished their own layout pass.
  // On Android this races against the OS-level window resize
  // (windowSoftInputMode="adjustResize" — Expo's default; no override is
  // configured in app.json) and KeyboardAvoidingView's own `behavior="height"`
  // frame measurement, both of which need a settled layout to compute
  // correctly. When the keyboard opens before that settles, the height
  // calculation is taken from a stale/incomplete frame, so the container
  // doesn't shrink enough — leaving the body field (and on small screens,
  // the sticky footer) covered. This is a plausible, and the most PROBABLE,
  // explanation for the docx's reported symptom, since this is the ONLY
  // multi-step form in the app that autoFocuses a field as part of a step
  // transition (app/venue/add.tsx and app/profile/edit.tsx's multiline
  // inputs are not autoFocused, and are not reported as broken).
  //
  // Fix: focus imperatively via a ref, triggered by the step-2 content's own
  // onLayout event instead of a guessed setTimeout delay — onLayout fires
  // once Yoga has actually committed that View's layout, which is the real
  // signal that the surrounding layout (KeyboardAvoidingView, ScrollView,
  // footer) has settled enough to safely open the keyboard against. A blind
  // timer duration is exactly the kind of arbitrary, undocumented-margin
  // offset that tends to be right on one device and wrong on another;
  // onLayout has no such guess built in. Guarded by a ref (not state) so it
  // fires exactly once per step-2 entry — onLayout can refire on later
  // relayouts (e.g. the tag row wrapping differently once a chip is toggled)
  // and must not refocus/reopen the keyboard on every one of those.
  const bodyInputRef = useRef<TextInput>(null);
  const hasFocusedStep2Ref = useRef(false);
  useEffect(() => {
    if (step !== 2) hasFocusedStep2Ref.current = false;
  }, [step]);
  function handleStep2Layout() {
    if (step !== 2 || hasFocusedStep2Ref.current) return;
    hasFocusedStep2Ref.current = true;
    bodyInputRef.current?.focus();
  }

  // Defensive backstop for "the focused input must scroll fully above the
  // keyboard": React Native's own ScrollView-scrolls-focused-TextInput-
  // above-keyboard mechanism depends on an accurate keyboard height being
  // reported to JS, which is a documented Android flakiness on some OEM
  // keyboards/versions when combined with adjustResize (the height/frame
  // event can be mistimed or under-report). Rather than guessing how long
  // that report takes, listen for the real `keyboardDidShow` event (fired
  // once Android has actually reported the final keyboard frame) and scroll
  // then — deterministic against the real signal instead of a timer. Scoped
  // to Android + step 2 only: iOS is not reported as affected and already
  // has its own `behavior="padding"` handling.
  const scrollRef = useRef<ScrollView>(null);
  function handleBodyFocus() {
    setBodyFocused(true);
  }
  useEffect(() => {
    if (Platform.OS !== 'android' || step !== 2) return undefined;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, [step]);

  // Computed (not guessed) footer clearance — see FOOTER_* constants above.
  const footerHeight = FOOTER_TOP_PADDING + FOOTER_BUTTON_HEIGHT + Math.max(28, insets.bottom + 12);
  const scrollContentStyle = useMemo(
    () => [styles.scrollContent, { paddingBottom: footerHeight + FOOTER_SCROLL_GAP }],
    [styles, footerHeight],
  );

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
          // useSubmitReview's own-venue guard throws the internal sentinel
          // 'OWNER_REVIEW_NOT_ALLOWED' (not a user-facing string — every
          // other branch in that hook already throws a friendly message).
          // This screen's own isOwnVenue gate should make that guard
          // unreachable in normal use, but if it ever is reached (e.g. venue
          // ownership changing between page load and submit), the raw
          // internal code must never reach Alert.alert.
          const message =
            err instanceof Error && err.message !== 'OWNER_REVIEW_NOT_ALLOWED'
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
    <View style={styles.outer}>
      <ThemedBackground />
      {/* edges=['top'] only: FlowFooter is the single source of truth for the
          bottom safe-area inset (it already reads insets.bottom for its own
          paddingBottom). Without this restriction SafeAreaView ALSO reserves
          insets.bottom as padding around KeyboardAvoidingView, stacking on
          top of FlowFooter's own inset — the same double-counted-inset "dead
          gap above the footer" bug already identified and fixed this way in
          app/profile/edit.tsx (Phase 5C, SAVE_BAR_* constants). */}
      <SafeAreaView style={styles.root} edges={['top']}>
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
            styles={styles}
            PP={PP}
          />

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={scrollContentStyle}
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
                    <Text style={styles.venueMiniPillText} maxFontSizeMultiplier={1.3}>REVIEW</Text>
                  </View>
                </View>

                {/* Rating block */}
                <View style={styles.ratingBlock}>
                  <Text style={styles.ratingCopy}>{RATING_COPY[rating]}</Text>
                  {rating === 0 && (
                    <Text style={styles.ratingHint}>Tap a star</Text>
                  )}

                  {/* Stars row — amber filled vs dark-outline, selected state
                      obvious at a glance. Size unchanged (46). */}
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
                          color={rating >= n ? PP.star : PP.mute}
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
              <View onLayout={handleStep2Layout} testID="review-step-2">
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
                  Your review <Text style={{ color: PP.error }}>*</Text>
                </Text>
                <View
                  style={[
                    styles.bodyContainer,
                    (bodyFocused || body.length > 0) && styles.bodyContainerFocused,
                  ]}
                >
                  <TextInput
                    ref={bodyInputRef}
                    style={styles.bodyInput}
                    value={body}
                    onChangeText={setBody}
                    onFocus={handleBodyFocus}
                    onBlur={() => setBodyFocused(false)}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    maxLength={BODY_MAX}
                    placeholder="What would you tell another parent? Parking? Facilities? Age suitability?"
                    placeholderTextColor={T.label4}
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
                    maxFontSizeMultiplier={1.3}
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
                {/* Hero circles — Ocean accent (was coral) */}
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
                      <Text style={styles.previewAvatarText} maxFontSizeMultiplier={1.3}>
                        {anonymous ? '?' : 'Y'}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewName}>
                        {anonymous ? 'Anonymous parent' : 'You'}
                      </Text>
                      <Text style={styles.previewTime}>Just now</Text>
                    </View>

                    <Stars rating={rating} size={12} color={PP.star} />
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
              styles={styles}
              tintColor={footerTint}
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
              styles={styles}
              tintColor={footerTint}
            />
          )}
          {step === 3 && (
            <FlowFooter primary="Back to venue" onPrimary={onSuccess} styles={styles} tintColor={footerTint} />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// createStyles(PP) — called via useMemo inside ReviewForm so every colour
// resolves per the current app theme mode (same pattern as
// app/venue/plan-visit.tsx's createStyles(pp)).
function createStyles(PP: PPType) {
  return StyleSheet.create({
  // Layout
  outer: {
    flex: 1,
    // Transparent so the shared <ThemedBackground/> atmosphere shows through —
    // matches Home / Venue Detail / Plan Visit. Cards/inputs stay opaque.
    backgroundColor: 'transparent',
  },
  root: {
    flex: 1,
    backgroundColor: 'transparent',
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
    borderRadius: 12,
    backgroundColor: PP.paper,
    borderWidth: 1,
    borderColor: PP.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
  },
  stepLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: PP.mute,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepTitle: {
    fontFamily: FontFamily.display,
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
    // Phase 6: this 120 is now only a fallback base — the ReviewForm
    // component always merges a computed `{ paddingBottom }` override
    // (footerHeight + FOOTER_SCROLL_GAP) on top of this style array, so the
    // real clearance tracks FlowFooter's actual formula (incl. safe-area
    // inset) instead of a flat guess. See scrollContentStyle in ReviewForm().
    paddingBottom: 120,
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  // Phase 3 (glass button system): FlowFooter's primary CTA is now a
  // <GlassButton/> — colour/disabled-dimming come from its own variant
  // resolution, so only layout survives here (no backgroundColor: this
  // style is merged AFTER GlassButton's internal preset, and colour must
  // only ever come from variant/active, never a style override).
  footerPrimaryLayout: {
    flex: 1.4,
    borderRadius: 14,
    paddingVertical: 14,
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
    fontFamily: FontFamily.bodyStrong,
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
    fontFamily: FontFamily.heading,
    fontSize: 13,
    color: PP.ink,
  },
  venueMiniLabel: {
    fontFamily: FontFamily.bodyStrong,
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
    fontFamily: FontFamily.caption,
    fontSize: 10,
    color: PP.skyText,
  },

  // Step 1 — rating
  ratingBlock: {
    paddingTop: 30,
    paddingBottom: 10,
    alignItems: 'center',
  },
  ratingCopy: {
    fontFamily: FontFamily.heading,
    fontSize: 16,
    color: PP.ink,
    textAlign: 'center',
  },
  ratingHint: {
    fontFamily: FontFamily.bodyStrong,
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
    backgroundColor: PP.paper,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  trustNoteText: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: PP.inkSoft,
    lineHeight: 18,
  },

  // Step 2 — shared label
  fieldLabel: {
    fontFamily: FontFamily.bodyStrong,
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
    backgroundColor: PP.sky,
    borderColor: PP.sky,
  },
  tagChipUnselected: {
    backgroundColor: PP.paper,
    borderColor: PP.line,
  },
  tagChipText: {
    fontFamily: FontFamily.bodyStrong,
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
    backgroundColor: PP.bg,
    borderWidth: 1.5,
    borderColor: PP.line,
    borderRadius: 12,
    padding: 14,
    minHeight: 110,
  },
  bodyContainerFocused: {
    borderColor: PP.sky,
  },
  bodyInput: {
    flex: 1,
    fontFamily: FontFamily.body,
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
    fontFamily: FontFamily.bodyStrong,
    fontSize: 11,
    color: PP.mute,
  },
  charCountOver: {
    color: PP.error,
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
    backgroundColor: PP.sky,
    borderColor: PP.sky,
  },
  anonTitle: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: PP.ink,
  },
  anonSub: {
    fontFamily: FontFamily.body,
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
    backgroundColor: PP.skyWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PP.sky,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successHeading: {
    fontFamily: FontFamily.display,
    fontSize: 24,
    color: PP.ink,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  successSub: {
    fontFamily: FontFamily.body,
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
    backgroundColor: PP.sky,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAvatarText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: '#fff',
  },
  previewName: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: PP.ink,
  },
  previewTime: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    color: PP.mute,
  },
  previewBody: {
    fontFamily: FontFamily.body,
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
    fontFamily: FontFamily.bodyStrong,
    fontSize: 10,
    color: PP.skyText,
  },

  // Shared error text
  fieldError: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: PP.error,
    marginTop: 6,
  },
  });
}
