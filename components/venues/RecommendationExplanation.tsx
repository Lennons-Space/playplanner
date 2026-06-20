// ─────────────────────────────────────────────────────────────────────────────
// components/venues/RecommendationExplanation.tsx
//
// "Why We Recommended This" card — shown on the venue detail screen between
// the main info card and the About section.
//
// DESIGN PRINCIPLES:
//   • Calls generateRecommendationExplanation() internally; renders null when
//     the engine returns null (no honest reason available).
//   • Never renders any numeric score — only the title and reason strings.
//   • Inline styles with the pp design tokens to match app/venue/[id].tsx.
//   • Accessible: reasons are individually readable by screen readers.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import type { Venue } from '@/types';
import { generateRecommendationExplanation } from '@/lib/recommendations/recommendationExplanation';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

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
  const explanation = generateRecommendationExplanation(venue);

  // Engine found no honest reason — hide the section entirely.
  if (explanation === null) return null;

  const { title, reasons } = explanation;

  return (
    <View style={styles.card} accessible={false}>
      {/* Top accent bar (v2) */}
      <View style={styles.accentBar} />

      <View style={styles.inner}>
        {/* Header: sparkle + uppercase overline */}
        <View style={styles.headerRow}>
          <Icon name="sparkle" size={14} color={Colors.accent} />
          <Text style={styles.overline} accessibilityRole="header">
            Why we recommended this
          </Text>
        </View>

        {/* Context headline (the engine's title) */}
        <Text style={styles.headline}>{title}</Text>

        {/* Reasons list — accent circle + white check */}
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
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Accent-tinted card (accent at ~16%) with a clipped top accent bar.
  card: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.section,
    overflow: 'hidden',
    marginTop: 22,
  },
  accentBar: {
    height: 3,
    backgroundColor: 'rgba(76,141,246,0.55)',
  },
  inner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 15,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  overline: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  headline: {
    fontFamily: FontFamily.body,
    fontSize: 14.5,
    color: Colors.label2,
    lineHeight: 21,
    marginBottom: 11,
  },

  reasonsList: {
    gap: 8,
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
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  reasonText: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: Colors.label2,
    flexShrink: 1,
    lineHeight: 20,
  },
});
