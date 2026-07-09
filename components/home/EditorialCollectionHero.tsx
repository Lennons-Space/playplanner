// ─────────────────────────────────────────────────────────────────────────
// EditorialCollectionHero — the "Good for today" card on the v2 Home screen.
//
// EXACT-V2 SOURCE (final pp2-home.jsx `EditorialCollectionHero`, as rendered
// by Play Planner v2.html — the design authority): a 192px editorial card
// that opens a COLLECTION, never a venue. Dark per-collection 145° gradient,
// hairline border, top-left frosted "COLLECTION" badge, an 86px low-opacity
// emoji watermark on the right, title (23/800/display) + description
// (13.5, white @0.52), and a solid-accent "Explore →" pill bottom-right.
// The venue-photo SmartFeaturedCard previously rendered here belonged to an
// OLDER design iteration (01-home-dark.png / README) — not chased.
//
// Android safety: the prototype's `backdrop-filter: blur(8px)` on the badge
// is approximated with a plain translucent fill + hairline border (the same
// GlassSurface approach used app-wide since the BlurView crash fix). The
// radial accent glow is a react-native-svg RadialGradient — the same pattern
// V2Background already uses.
//
// Content honesty: title/desc/emoji are editorial copy describing a REAL app
// collection (lib/homeIntents.pickHeroCollection maps every hero onto
// lib/collections keys). No venue data, no fabricated venues.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FontFamily, BorderRadius } from '@/constants/theme';
import type { HeroCollectionDef } from '@/lib/homeIntents';

export interface EditorialCollectionHeroProps {
  coll: HeroCollectionDef;
  onPress: () => void;
}

export function EditorialCollectionHero({ coll, onPress }: EditorialCollectionHeroProps) {
  return (
    <Pressable
      onPress={onPress}
      testID="home-collection-hero"
      accessibilityRole="button"
      accessibilityLabel={`${coll.title} collection — ${coll.desc}`}
      // STATIC style object only — the dev build's NativeWind 4 interop
      // silently drops Pressable style-as-function props on device (this is
      // why the card rendered square/unclipped on 2026-07-09's screenshot).
      // Press feedback comes from android_ripple instead of the prototype's
      // scale-down.
      android_ripple={{ color: 'rgba(255,255,255,0.08)', foreground: true }}
      style={{
        // 176 (down from the prototype's 192, 2026-07-09 round 3): the web
        // frame had ~100px more vertical room than a real Android viewport;
        // the trim keeps the full hero + Explore pill visible above the tab
        // bar without changing its proportions meaningfully.
        height: 176,
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
      }}
    >
      {/* Per-collection dark gradient (prototype: 145deg gd1 → gd2). */}
      <LinearGradient
        colors={[coll.gd1, coll.gd2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Soft accent radial glow, top-right (prototype: 240px circle @0x28). */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="92%" cy="-8%" r="75%">
            <Stop offset={0} stopColor={coll.accent} stopOpacity={0.16} />
            <Stop offset={0.65} stopColor={coll.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#heroGlow)" />
      </Svg>

      {/* Giant emoji watermark, vertically centred on the right. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 20,
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        <Text style={{ fontSize: 86, opacity: 0.18, lineHeight: 96 }}>{coll.emoji}</Text>
      </View>

      {/* Content — badge block pinned to the top, text block to the bottom,
          both in NORMAL FLOW (justifyContent: 'space-between'), so the badge
          can never overlap the title/description regardless of text length
          or the device's font-scale setting. (The prototype absolutely
          positioned the badge, which is only safe at a fixed 390px web
          viewport.) Yoga insets absolute children by parent padding, so the
          padding lives on this wrapper — not the Pressable — to keep the
          gradient/glow/watermark full-bleed. */}
      <View
        style={{
          flex: 1,
          justifyContent: 'space-between',
          paddingTop: 14,
          paddingBottom: 16,
          paddingHorizontal: 20,
        }}
      >
        {/* Frosted "COLLECTION" badge, top-left (Android-safe glass:
            translucent fill + hairline, no BlurView). */}
        <View
          style={{
            alignSelf: 'flex-start',
            marginLeft: -2, // jsx badge sits at 18px, text column at 20px
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.13)',
            borderRadius: BorderRadius.pill,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 13 }} maxFontSizeMultiplier={1.2}>
            {coll.emoji}
          </Text>
          <Text
            style={{
              fontFamily: FontFamily.caption,
              fontSize: 11,
              color: coll.accent,
              textTransform: 'uppercase',
              letterSpacing: 0.66, // 0.06em @ 11px
            }}
            maxFontSizeMultiplier={1.2}
          >
            Collection
          </Text>
        </View>

        {/* Bottom row: title + desc (left) and the Explore pill (right). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontFamily: FontFamily.display,
                fontSize: 23,
                color: 'rgba(255,255,255,0.94)',
                letterSpacing: -0.6,
                lineHeight: 24, // jsx: line-height 1.05
                marginBottom: 5,
              }}
              // The prototype's <p> wraps naturally; on narrow phone widths
              // titles like "Plan for Tomorrow" need the second line the web
              // frame never did. Never truncate to "Plan for Tomo…".
              numberOfLines={2}
              maxFontSizeMultiplier={1.2}
            >
              {coll.title}
            </Text>
            <Text
              style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: 'rgba(255,255,255,0.52)' }}
              numberOfLines={2}
              maxFontSizeMultiplier={1.2}
            >
              {coll.desc}
            </Text>
          </View>
          <View
            style={{
              flexShrink: 0,
              backgroundColor: coll.accent,
              borderRadius: BorderRadius.pill,
              paddingHorizontal: 16,
              paddingVertical: 9,
            }}
          >
            <Text
              style={{ fontFamily: FontFamily.caption, fontSize: 13.5, color: '#FFFFFF' }}
              maxFontSizeMultiplier={1.2}
            >
              Explore →
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
