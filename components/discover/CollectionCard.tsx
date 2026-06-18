// ─────────────────────────────────────────────────────────────────────────
// CollectionCard — a floating paper bubble on the Discover screen
// (Headspace × Airbnb × Apple Weather × Pinterest). Three scales:
//   • hero      → the tall "Seasonal Picks" magazine cover (hero).
//   • compact   → a small mosaic tile in the 2-column Collections grid.
//   • (default) → a full-width bubble (kept for flexibility; unused on Discover).
//
// Luxury language: large soft radius, very soft Home-style shadow (no borders),
// a CENTERED column with lots of whitespace, an OVERSIZED faded background glyph
// occupying a corner (~0.025 opacity — decorative, never competing), minimal
// text, and a soft translucent "Explore" pill that feels tactile.
//
// NOTE: we have no illustration assets, so the oversized corner "illustration"
// is the collection's own emoji, scaled up and heavily faded. The Explore pill
// uses iOS shadow only (no Android elevation) — elevation on a translucent fill
// renders an opaque plate on Android (same lesson as Home's SECTION_BUBBLE).
//
// Presentation only — all data/membership/pill logic lives in lib/collections.
// ─────────────────────────────────────────────────────────────────────────

import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontFamily } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/categories';
import { CollectionIllustration } from '@/components/discover/illustrations/CollectionIllustration';
import type { CollectionDef } from '@/lib/collections';

// Dark warm ink that reads well on every (light) collection gradient.
const INK = '#1C1408';
const INK_SOFT = 'rgba(28,20,8,0.62)';
const INK_PILL = 'rgba(28,20,8,0.72)';
// Deep ocean blue — elegant + readable on the light gradients.
const EXPLORE_BLUE = '#2E6FD6';

export type CollectionCardLayout = 'right' | 'left' | 'center';

export interface CollectionCardProps {
  def: CollectionDef;
  onPress: () => void;
  /** Which corner the oversized faded glyph sits in. */
  layout?: CollectionCardLayout;
  /** Tall magazine-cover treatment — for the "Seasonal Picks" hero. */
  hero?: boolean;
  /** Small mosaic-tile treatment — for the 2-column Collections grid. */
  compact?: boolean;
  /** Per-tile height (compact only) so the mosaic can stagger like Pinterest. */
  compactHeight?: number;
}

export function CollectionCard({ def, onPress, layout = 'right', hero = false, compact = false, compactHeight }: CollectionCardProps) {
  const { width } = useWindowDimensions();
  const pillLabels = def.pillSlugs.map((slug) => getCategoryMeta(slug).label);
  // Compact tiles drop the tagline and show at most two categories as a quiet
  // dotted line; the hero keeps richer translucent chips.
  const compactCats = pillLabels.slice(0, 2).join('  •  ');

  // Scale tokens per treatment. Big soft radii so every object reads as a
  // bubble of paper, not a panel — hero 60, mosaic tiles 56.
  const minHeight = hero ? 300 : compact ? (compactHeight ?? 160) : 186;
  const radius = hero ? 60 : compact ? 56 : 56;
  const pad = hero ? 34 : compact ? 20 : 26;
  // Hero title is responsive: stays 35 on normal/wide screens (unchanged look),
  // steps down only on narrow Android widths to keep ≤2 lines without clipping.
  const titleSize = hero ? (width < 360 ? 30 : width < 410 ? 33 : 35) : compact ? 16.5 : 23;
  const glyphSize = hero ? 230 : 158;
  const off = hero ? -44 : -40; // how far the illustration is pushed off the corner

  // Oversized faded illustration, anchored to a corner (per card so cards differ).
  const glyphWrap =
    layout === 'left'
      ? { left: off, bottom: off }
      : layout === 'center'
        ? { left: 0, right: 0, top: hero ? -36 : -22, alignItems: 'center' as const }
        : { right: off, top: off };

  // Gentle per-card tilt on the faded line-art so the decoration feels hand-
  // placed, not stamped — softens the geometric grid feel.
  const glyphRotate = layout === 'left' ? '-12deg' : layout === 'center' ? '6deg' : '10deg';

  const ExplorePill = (
    <View
      style={{
        backgroundColor: 'rgba(255,255,255,0.55)',
        borderRadius: 999,
        paddingHorizontal: compact ? 12 : 15,
        paddingVertical: compact ? 6 : 8,
        // iOS-only soft shadow (no elevation → no Android plate on translucent fill).
        shadowColor: '#2A1E0A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      }}
    >
      <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: compact ? 12 : 13.5, color: EXPLORE_BLUE, letterSpacing: 0.2 }}>
        Explore →
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${def.title}.${hero ? ` ${def.tagline}` : ''}${pillLabels.length ? ` ${pillLabels.slice(0, hero ? 3 : 2).join(', ')}.` : ''}`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.97 : 1,
        transform: [{ scale: pressed ? 0.992 : 1 }],
      })}
    >
      {/* OUTER shadow wrapper — owns the soft shadow + Android elevation ONLY.
          No overflow:'hidden' here, so the large-blur shadow isn't clipped and
          (critically on Android) elevation never sits on the same view that does
          the rounded clipping. backgroundColor matches the gradient's first stop
          so Android has a solid surface to cast the elevation shadow from and any
          sub-pixel corner seam is invisible — NOT a visible colour change. */}
      <View
        style={{
          borderRadius: radius,
          backgroundColor: def.gradient[0],
          // Hero only: a subtle hairline edge so the card boundary reads clearly
          // against the warm background on a physical Android screen. Compact
          // tiles keep no border (unchanged). Shadow is untouched.
          borderWidth: hero ? 1 : 0,
          borderColor: 'rgba(28,20,8,0.08)',
          shadowColor: '#2A1E0A',
          shadowOffset: { width: 0, height: hero ? 16 : 12 },
          shadowOpacity: 0.04,
          shadowRadius: hero ? 48 : 40,
          elevation: hero ? 4 : 3,
        }}
      >
        {/* INNER clipped card — owns the rounded clip (overflow:'hidden', NO
            elevation). The coloured gradient lives inside and is clipped to the
            same radius, so no square corner can bleed past. */}
        <View style={{ borderRadius: radius, overflow: 'hidden' }}>
          <LinearGradient
            colors={def.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: radius,
              minHeight,
              paddingHorizontal: pad,
              paddingVertical: pad,
              alignItems: 'center',
              // Hero: title near top, Explore near the bottom (breathing room between).
              // Otherwise: a compact centred column floating in whitespace.
              justifyContent: hero ? 'space-between' : 'center',
            }}
          >
        {/* Oversized faded line-art — decorative corner illustration */}
        <View
          pointerEvents="none"
          style={[{ position: 'absolute', opacity: 0.1, transform: [{ rotate: glyphRotate }] }, glyphWrap]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <CollectionIllustration illustrationKey={def.illustrationKey} size={glyphSize} color={def.accent} />
        </View>

        {/* Centred title column */}
        <View style={{ alignItems: 'center' }}>
          {/* Clean type — the corner illustration now carries the personality.
              Capped at 2 lines so a long title can never clip horizontally; the
              card's minHeight lets it grow vertically if accessibility text needs it. */}
          <Text
            numberOfLines={2}
            style={{ fontFamily: FontFamily.display, fontSize: titleSize, color: INK, letterSpacing: -0.5, textAlign: 'center' }}
          >
            {def.title}
          </Text>

          {/* Hero keeps a one-line tagline; compact tiles drop it for calm. */}
          {hero && (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 16, color: INK_SOFT, textAlign: 'center', marginTop: 8 }}>
              {def.tagline}
            </Text>
          )}

          {/* Hero: translucent category chips. */}
          {hero && pillLabels.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14, justifyContent: 'center' }}>
              {pillLabels.slice(0, 3).map((label) => (
                <View
                  key={label}
                  style={{ backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4.5 }}
                >
                  <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 11.5, color: INK_PILL }}>{label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Compact: a single quiet dotted category line (omitted when none). */}
          {compact && compactCats.length > 0 && (
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 11, color: 'rgba(28,20,8,0.48)', textAlign: 'center', marginTop: 6 }}>
              {compactCats}
            </Text>
          )}

          {/* Compact mosaic tiles use a QUIET text-link affordance (the whole
              card is tappable) instead of repeating a heavy Explore pill on every
              tile. The full pill is reserved for the Seasonal hero. */}
          {!hero && (
            <View style={{ marginTop: compact ? 12 : 16 }}>
              {compact ? (
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: EXPLORE_BLUE, letterSpacing: 0.3 }}>
                  Explore →
                </Text>
              ) : (
                ExplorePill
              )}
            </View>
          )}
        </View>

        {/* Hero: Explore pill sits near the bottom of the cover. */}
        {hero && <View style={{ alignItems: 'center' }}>{ExplorePill}</View>}
          </LinearGradient>
        </View>
      </View>
    </Pressable>
  );
}
