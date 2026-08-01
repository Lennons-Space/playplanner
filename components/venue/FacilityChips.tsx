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
import { ocean, FontFamily, BorderRadius } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

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
  const { tokens: T } = useAppTheme();
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
      <Text style={[styles.heading, { color: T.label }]}>What&apos;s here?</Text>
      <Text style={[styles.subheading, { color: T.label3 }]}>Tap to let other parents know</Text>
      <View style={styles.row}>
        {CHIP_DEFS.map((def) => (
          <FacilityChip
            key={def.slug}
            def={def}
            stat={stats?.[def.slug]}
            isSignedIn={!!user}
            disabled={castVote.isPending}
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
  disabled: boolean;
  onPress: () => void;
}

function FacilityChip({ def, stat, disabled, onPress }: FacilityChipProps) {
  const { tokens: T } = useAppTheme();
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
        <Text style={[styles.chipText, styles.chipTextOutline, { color: T.label }]} numberOfLines={1}>
          {def.label}
        </Text>
      </>
    );
  }

  return (
    // STATIC style array only — the dev build's NativeWind 4 interop silently
    // drops Pressable style-as-function props (see Home, 2026-07-09); press
    // feedback comes from android_ripple instead of the old opacity style.
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${def.label}. ${stateLabel}`}
      accessibilityHint="Confirms whether this facility is available at this venue"
      android_ripple={{ color: 'rgba(255,255,255,0.10)', foreground: true }}
      style={[
        styles.chip,
        filled ? styles.chipFilled : [styles.chipOutline, { backgroundColor: T.bg, borderColor: T.separator }],
        disabled ? styles.chipDisabled : null,
      ]}
    >
      {display}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16, // v2 sheet gutter
    paddingTop: 4,
    paddingBottom: 16,
  },
  heading: {
    fontFamily: FontFamily.heading,
    fontSize: 17,
    marginBottom: 2,
  },
  subheading: {
    fontFamily: FontFamily.body,
    fontSize: 13,
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
    borderRadius: BorderRadius.pill,
    gap: 6,
    overflow: 'hidden',
  },
  chipOutline: {
    // backgroundColor / borderColor: mode-aware, applied inline.
    borderWidth: 1,
  },
  // Selected state — the shared tinted-glass treatment (same tokens
  // GlassButton's active/primary variant resolves to: ocean.light fill +
  // a ~0.4-alpha accent hairline), not a solid fill. A heavy opaque
  // ocean.accent block was the one remaining place still using the
  // pre-Phase-3 solid-CTA pattern GlassButton replaced everywhere else
  // (Phase 8 visual-defect report — see components/ui/GlassButton.tsx's
  // doc comment for the full "why glass, not solid" reasoning).
  chipFilled: {
    backgroundColor: ocean.light,
    borderWidth: 1,
    borderColor: 'rgba(76,141,246,0.4)', // mirrors GlassButton's ACCENT_BORDER
  },
  chipDisabled: {
    opacity: 0.6,
  },
  emoji: {
    fontSize: 15,
  },
  chipText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
  },
  chipTextOutline: {
    // color: mode-aware, applied inline (T.label).
  },
  // A low-alpha tint fill cannot host white text at readable contrast (see
  // GlassButton's "WHY ACCENT-COLOURED TEXT INSTEAD OF WHITE" doc comment) —
  // the accent hex itself is the label colour, same as every other glass
  // control in the app.
  chipTextFilled: {
    color: ocean.accent,
  },
  checkMark: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: ocean.accent,
  },
  // The count badge stays a small SOLID accent pill (not tinted) — it's a
  // number that must stay clearly legible at a glance, and its footprint is
  // small enough that a solid accent chip-within-a-chip doesn't reintroduce
  // the "heavy block" problem the outer chip's fill was fixed for.
  countBadge: {
    backgroundColor: ocean.accent,
    borderRadius: BorderRadius.pill,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 12,
    color: '#FFFFFF',
  },
});
