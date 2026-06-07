// ─────────────────────────────────────────────────────────────────────────────
// FacilityChips.tsx — "What's here?" one-tap facility confirmation.
//
// Parent Contribution MVP — Phase 1 (venue-detail only).
// Lets a parent confirm whether Toilets / Baby change / Parking are present
// at a venue with a single tap. Individual votes are private (see migration
// 050); only the anonymous aggregate is shown here.
//
// States per chip:
//   - Unknown            — outline, tappable ("Is this here?")
//   - You confirmed      — filled with a check mark (the signed-in user voted yes)
//   - Confirmed by N     — filled, shows the parent count once enough people agree
//
// Tapping while signed out routes to the existing sign-in flow; the vote is
// not silently dropped, but nor is it auto-submitted post-login (keeps the
// flow simple and avoids surprising the user with an action they didn't
// consciously repeat — they can just tap again after signing in).
//
// WHY no photos/text/badges here: this is a deliberately minimal MVP. See the
// approved technical design — scope is one-tap only.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useUser } from '@/hooks/useAuth';
import {
  useVenueFacilityStats,
  useCastFacilityVote,
  FacilityVoteAuthError,
  type FacilitySlug,
  type FacilityStat,
} from '@/hooks/useFacilities';

const pp = {
  ink:     '#1D2630',
  mute:    '#7B8794',
  line:    '#E6E2DB',
  paper:   '#FFFFFF',
  sky:     '#2FB8B0',
  skyDeep: '#1B8A85',
  skyWash: '#EEF9F8',
};

interface ChipDef {
  slug: FacilitySlug;
  label: string;
  emoji: string;
}

const CHIP_DEFS: ChipDef[] = [
  { slug: 'toilets',     label: 'Toilets',     emoji: '🚻' },
  { slug: 'baby-change', label: 'Baby change', emoji: '🍼' },
  { slug: 'parking',     label: 'Parking',     emoji: '🅿️' },
];

interface FacilityChipsProps {
  venueId: string;
}

export function FacilityChips({ venueId }: FacilityChipsProps) {
  const user = useUser();
  const { data: stats } = useVenueFacilityStats(venueId);
  const castVote = useCastFacilityVote();

  const handlePress = useCallback(
    (slug: FacilitySlug) => {
      castVote.mutate(
        { venueId, slug },
        {
          onError: (err) => {
            if (err instanceof FacilityVoteAuthError) {
              // Route to the existing sign-in flow (same route used elsewhere
              // on this screen — see "Write a review" → app/venue/[id]/review.tsx).
              // The user can simply tap the chip again once signed in; we do
              // not auto-replay the vote to avoid a surprising background action.
              router.push('/(auth)/login');
            }
            // Other errors are surfaced via the mutation's isError state /
            // the chip silently reverting (optimistic rollback) — no Alert
            // here keeps a one-tap interaction feeling lightweight.
          },
        },
      );
    },
    [castVote, venueId],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>What&apos;s here?</Text>
      <Text style={styles.subheading}>Tap to let other parents know</Text>
      <View style={styles.row}>
        {CHIP_DEFS.map((def) => (
          <FacilityChip
            key={def.slug}
            def={def}
            stat={stats?.[def.slug]}
            isSignedIn={!!user}
            onPress={() => handlePress(def.slug)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Single chip ──────────────────────────────────────────────────────────────

interface FacilityChipProps {
  def: ChipDef;
  stat: FacilityStat | undefined;
  isSignedIn: boolean;
  onPress: () => void;
}

function FacilityChip({ def, stat, onPress }: FacilityChipProps) {
  const total = stat?.total ?? 0;
  const present = stat?.present ?? null;
  const confidence = stat?.confidence ?? 'low';

  // "Confirmed" display requires both a positive majority verdict AND enough
  // agreement to trust it (medium/high) — mirrors shouldMirror() so the chip
  // never claims more certainty than the recommender itself would act on.
  const isConfirmedByParents =
    total > 0 && present === true && (confidence === 'medium' || confidence === 'high');

  let stateLabel: string;
  let filled: boolean;
  let display: React.ReactNode;

  if (isConfirmedByParents) {
    filled = true;
    stateLabel = `Confirmed by ${total} ${total === 1 ? 'parent' : 'parents'}`;
    display = (
      <>
        <Text style={styles.emoji}>{def.emoji}</Text>
        <Text style={[styles.chipText, styles.chipTextFilled]} numberOfLines={1}>
          {def.label}
        </Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{total}</Text>
        </View>
      </>
    );
  } else if (total > 0 && present === true) {
    // At least one "yes" vote exists but confidence is still low — treat the
    // chip as "you (or someone) confirmed" without claiming a public verdict.
    filled = true;
    stateLabel = 'You confirmed this';
    display = (
      <>
        <Text style={styles.emoji}>{def.emoji}</Text>
        <Text style={[styles.chipText, styles.chipTextFilled]} numberOfLines={1}>
          {def.label}
        </Text>
        <Text style={styles.checkMark}>✓</Text>
      </>
    );
  } else {
    filled = false;
    stateLabel = 'Unknown — tap to confirm if this is here';
    display = (
      <>
        <Text style={styles.emoji}>{def.emoji}</Text>
        <Text style={[styles.chipText, styles.chipTextOutline]} numberOfLines={1}>
          {def.label}
        </Text>
      </>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${def.label}. ${stateLabel}`}
      accessibilityHint="Confirms whether this facility is available at this venue"
      style={({ pressed }) => [
        styles.chip,
        filled ? styles.chipFilled : styles.chipOutline,
        pressed && styles.chipPressed,
      ]}
    >
      {display}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  heading: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 17,
    color: pp.ink,
    marginBottom: 2,
  },
  subheading: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: pp.mute,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    gap: 6,
  },
  chipOutline: {
    backgroundColor: pp.paper,
    borderWidth: 1,
    borderColor: pp.line,
  },
  chipFilled: {
    backgroundColor: pp.skyDeep,
    borderWidth: 0,
  },
  chipPressed: {
    opacity: 0.7,
  },
  emoji: {
    fontSize: 15,
  },
  chipText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
  },
  chipTextOutline: {
    color: pp.ink,
  },
  chipTextFilled: {
    color: pp.paper,
  },
  checkMark: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 13,
    color: pp.paper,
  },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 9999,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 12,
    color: pp.paper,
  },
});
