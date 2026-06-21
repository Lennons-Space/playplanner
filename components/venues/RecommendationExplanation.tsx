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
import { Colors, FontFamily, BorderRadius, Shadow } from '@/constants/theme';

// Green tick that signals a positive, verified-fit reason. Retained as a local
// exception (no design-system token) — mirrors the green open indicator kept on
// app/venue/[id].tsx in Phase 6A.1.
const POSITIVE_GREEN = '#5BC08A';

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
    <View
      style={styles.card}
      accessible={false}
    >
      {/* Title row: star icon + bold title */}
      <View style={styles.titleRow}>
        <Icon name="star" size={16} color={Colors.star} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>

      {/* Subheading */}
      <Text style={styles.subheading}>Why we recommended this</Text>

      {/* Reasons list */}
      <View style={styles.reasonsList}>
        {reasons.map((reason) => (
          <View
            key={reason}
            style={styles.reasonRow}
            accessible={true}
            accessibilityLabel={reason}
          >
            {/* Check icon in leaf/green to signal a positive attribute */}
            <Icon name="check" size={14} color={POSITIVE_GREEN} strokeWidth={2.5} />
            <Text style={styles.reasonText}>{reason}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    borderColor: Colors.separator,
    padding: 18,
    marginTop: 22,
    // Elevated card shadow from the design-system token set.
    ...Shadow.md,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 3,
  },

  title: {
    fontFamily: FontFamily.heading,
    fontSize: 17,
    color: Colors.label,
    letterSpacing: -0.2,
  },

  subheading: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
    marginBottom: 14,
    marginLeft: 23, // aligns with text in titleRow (icon width 16 + gap 7)
  },

  reasonsList: {
    gap: 10,
  },

  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  reasonText: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: Colors.label2,
    flexShrink: 1,
  },
});
