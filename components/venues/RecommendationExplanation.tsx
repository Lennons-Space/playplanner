// ─────────────────────────────────────────────────────────────────────────────
// components/venues/RecommendationExplanation.tsx
//
// "Why We Recommended This" card — shown on the venue detail screen between
// the stat strip and the info rows card.
//
// v2 STYLING (2026-07-09, pp2-venue.jsx `WhyRecommendedCard`): accent-tinted
// card with a 3px accent bar on top, star + uppercase "WHY WE RECOMMENDED
// THIS" overline, a headline, then check-circled reason rows. Dark-only —
// this component renders only on the (dark) v2 venue detail screen.
//
// DESIGN PRINCIPLES (unchanged):
//   • Calls generateRecommendationExplanation() internally; renders null when
//     the engine returns null (no honest reason available).
//   • Never renders any numeric score — only the title and reason strings.
//   • Accessible: reasons are individually readable by screen readers.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import type { Venue } from '@/types';
import { generateRecommendationExplanation } from '@/lib/recommendations/recommendationExplanation';
import { ocean, FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

const ACCENT = ocean;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  venue: Venue;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a soft card explaining why this venue was recommended.
 * Self-hides (returns null) when no honest explanation can be generated.
 *
 * No numbers, scores, or algorithmic output are ever rendered — only the
 * human-readable title and reason strings produced by the engine.
 */
export function RecommendationExplanation({ venue }: Props) {
  const { tokens: T } = useAppTheme();
  const explanation = generateRecommendationExplanation(venue);

  // Engine found no honest reason — hide the section entirely.
  if (explanation === null) return null;

  const { title, reasons } = explanation;

  return (
    <View style={styles.card} accessible={false}>
      {/* jsx: 3px accent bar across the top of the card */}
      <View style={styles.accentBar} />

      <View style={styles.body}>
        {/* Overline row: star + uppercase label */}
        <View style={styles.overlineRow}>
          <Icon name="star" size={13} color={ACCENT.accent} />
          <Text style={styles.overline} accessibilityRole="header">
            Why we recommended this
          </Text>
        </View>

        {/* Headline from the explanation engine */}
        <Text style={[styles.headline, { color: T.label2 }]}>{title}</Text>

        {/* Reasons list — check circles */}
        <View style={styles.reasonsList}>
          {reasons.map((reason) => (
            <View
              key={reason}
              style={styles.reasonRow}
              accessible={true}
              accessibilityLabel={reason}
            >
              <View style={styles.checkCircle}>
                <Icon name="check" size={9} color="#FFFFFF" strokeWidth={3} />
              </View>
              <Text style={[styles.reasonText, { color: T.label2 }]}>{reason}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: ACCENT.light,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 16,
  },
  accentBar: {
    height: 3,
    backgroundColor: ACCENT.accent,
    opacity: 0.55,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 15,
  },

  overlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  overline: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 11,
    color: ACCENT.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.99, // 0.09em @ 11px
  },

  headline: {
    fontFamily: FontFamily.body,
    fontSize: 14.5,
    lineHeight: 21,
    marginBottom: 11,
    // color: mode-aware, applied inline (T.label2).
  },

  reasonsList: {
    gap: 7,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  checkCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  reasonText: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    // color: mode-aware, applied inline (T.label2).
  },
});
