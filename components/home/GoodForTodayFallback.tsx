// ─────────────────────────────────────────────────────────────────────────
// CollectionHeroCard (file kept as GoodForTodayFallback for import stability) —
// Home's editorial collection hero. ONE clearly-contained, tappable card that
// reads as a single editorial collection, not scattered elements on the page.
//
// Composition (vertically grouped, never scattered):
//   <emoji>
//   Title            (bold, responsive 42–52)
//   Tagline
//   [ Explore → ]
//
// Surface: a soft translucent paper panel so weather ambience shows through
// while dark ink stays readable in every weather theme. The collection's accent
// colour carries identity (emoji, a clipped corner blob, the Explore pill). All
// decoration is clipped inside the card (overflow: hidden) so nothing bleeds
// into later sections. No photo, no fabricated venue/rating/popularity. Routing
// is passed in by Home (no expo-router import here).
// ─────────────────────────────────────────────────────────────────────────

import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { FontFamily } from '@/constants/theme';
import type { CollectionDef } from '@/lib/collections';

// Warm dark ink — readable on the light translucent paper surface in every theme.
const INK = '#1C1408';
const INK_SOFT = 'rgba(28,20,8,0.66)';

export interface GoodForTodayFallbackProps {
  def: CollectionDef;
  /** Open the collection page (Home owns routing → no expo-router import here). */
  onPress: () => void;
}

export function GoodForTodayFallback({ def, onPress }: GoodForTodayFallbackProps) {
  const { width } = useWindowDimensions();
  // Bold but contained — scales with device width, never dominating the screen.
  const titleSize = width < 360 ? 42 : width < 410 ? 47 : 52;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${def.title}. ${def.tagline}. Open collection.`}
      style={({ pressed }) => ({
        minHeight: 280,
        borderRadius: 40,
        overflow: 'hidden',
        // Soft translucent paper — weather ambience shows through; dark ink stays
        // readable on every theme. Matches Home's paper-island language.
        backgroundColor: 'rgba(255,255,255,0.7)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.55)',
        padding: 24,
        justifyContent: 'center',
        shadowColor: '#2A1E0A',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.1,
        shadowRadius: 30,
        opacity: pressed ? 0.96 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      {/* Clipped decorative accent blob — supports the composition, never escapes
          the card (overflow: hidden on the Pressable clips it). */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -56,
          right: -44,
          width: 190,
          height: 190,
          borderRadius: 95,
          backgroundColor: def.accent,
          opacity: 0.12,
        }}
      />

      {/* Grouped editorial content */}
      <View>
        {/* Emoji + small eyebrow — frames Home as a CONCISE preview ("today's
            idea"), distinct from Discover's full seasonal collection feature
            (same title + destination, but recognisably the lighter surface). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 20 }}>{def.emoji}</Text>
          <Text
            style={{
              fontFamily: FontFamily.bodyStrong,
              fontSize: 11.5,
              letterSpacing: 1.4,
              color: def.accent,
              textTransform: 'uppercase',
            }}
          >
            Today&apos;s idea
          </Text>
        </View>
        <Text
          style={{
            fontFamily: FontFamily.display,
            fontSize: titleSize,
            color: INK,
            letterSpacing: -1,
            lineHeight: titleSize + 2,
          }}
          numberOfLines={2}
        >
          {def.title}
        </Text>
        <Text
          style={{ fontFamily: FontFamily.body, fontSize: 15.5, color: INK_SOFT, marginTop: 8, lineHeight: 21 }}
        >
          {def.tagline}
        </Text>

        {/* One obvious Explore action (accent pill). The whole card is tappable;
            this keeps the call-to-action visually clear. */}
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 20,
            backgroundColor: def.accent,
            borderRadius: 999,
            paddingHorizontal: 20,
            paddingVertical: 11,
          }}
        >
          <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14, color: '#FFFFFF' }}>
            Explore →
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
