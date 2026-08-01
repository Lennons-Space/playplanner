// ─────────────────────────────────────────────────────────────────────────
// GlassButton — the shared tinted-glass button/control primitive for
// Play Planner v2 (Phase 3 of the UI repair sprint, "global controls,
// buttons and tabs").
//
// WHY GLASS-TINT INSTEAD OF SOLID FILL:
// Every screen built so far already renders on top of the v2 atmosphere
// layer (<V2Background/> / <ThemedBackground/>) via translucent surfaces —
// GlassSurface (tab bar, cards, sticky bars) uses a mode-aware low-opacity
// fill + hairline border rather than an opaque block, specifically so the
// weather atmosphere reads through and the chrome never looks like a flat
// cut-out pasted on top of it. Solid-ACCENT-fill buttons (the pre-Phase-3
// pattern audited across ~20 call sites) were the one remaining place still
// using an opaque block colour — visually inconsistent with the rest of the
// glass system, and in LIGHT mode a solid #4C8DF6 fill reads as a much
// harder, more saturated block than anything else on screen. Tinting the
// button the same way GlassSurface tints its containers (low-alpha accent
// over the resolved theme background) keeps every interactive surface in
// the app speaking the same "glass" visual language.
//
// WHY ACCENT-COLOURED TEXT INSTEAD OF WHITE:
// A solid accent fill can always host white text/icons at full contrast.
// A LOW-alpha tint cannot — it is mostly showing the theme's own surface
// colour through it (a near-white card in light mode, a near-black one in
// dark mode), so white text on light mode's tint would be close to
// invisible. Instead the label/icon use the accent colour itself
// (Ocean `#4C8DF6`), which is a "tinted glass CTA" pattern: the same hex
// value reads clearly in BOTH modes because it has enough luminance
// contrast against light mode's near-white surfaces (label vs surface
// contrast ~3.1:1 for large/bold text, which this always is —
// FontFamily.bodyStrong/caption) and against dark mode's near-black
// surfaces (contrast well above 4.5:1). Falling back to `tokens.label`
// (plain theme ink) was considered and rejected: it would make the button
// look identical to a plain unselected chip, losing the "this is the
// accent action" signal the colour otherwise carries everywhere else in
// the app (chip active-rings, badges, links all use the same accent hex).
//
// STATIC STYLE / android_ripple RULE (repo-wide gotcha):
// NativeWind 4.0.1's babel interop silently drops function-as-style
// Pressables on-device (`style={(state) => ({...})}` works in Jest/
// simulators but is dropped on real Android/iOS builds). This component
// NEVER passes a function to Pressable's `style` — every style below is a
// plain object/array computed from props/state once per render, and press
// feedback comes from `android_ripple` only, exactly like the established
// pattern at app/(tabs)/search.tsx's `SearchChip` and app/(tabs)/map.tsx's
// `DarkChip`/`GlassBtn`. Do not regress this.
//
// active vs variant:
// `variant` picks the colour family ('primary' = Ocean accent, 'destructive'
// = coral/error). `active` is a SEPARATE boolean for chip/toggle call sites
// (category chips, the Map List/Map segmented toggle, age-range chips) where
// the SAME control needs an "unselected resting" look (tokens.surface fill +
// tokens.separator border + tokens.label2 text) as well as the tinted
// "selected" look. Plain CTA buttons (Save, Submit, Apply filters, ...)
// never pass `active` — it defaults to `true`, which is exactly the
// permanently-tinted CTA treatment.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Colors, FontFamily } from '@/constants/theme';

export type GlassButtonVariant = 'primary' | 'destructive';

export interface GlassButtonProps {
  /** Colour family. Default 'primary' (Ocean accent). */
  variant?: GlassButtonVariant;
  /**
   * Selected/resting switch for chip-and-toggle call sites. Default `true`
   * (always-tinted CTA look) — pass `false`/`true` explicitly when this
   * control is one of a set of mutually-exclusive chips/segments.
   */
  active?: boolean;
  /** Text label — renders a <Text> in the resolved colour. */
  label?: string;
  /** Optional leading icon/element, rendered before the label. */
  icon?: React.ReactNode;
  /** Full custom content — takes priority over label/icon when provided. */
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Swaps the inner content for a colour-matched spinner; footprint unchanged. */
  loading?: boolean;
  /** Layout-only overrides (padding/radius/minWidth/flex/margin, ...) — merged
   * AFTER the internal preset. Never use this to set backgroundColor/
   * borderColor: colour is only ever resolved via `variant`/`active` so every
   * button stays theme- and contrast-correct. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  testID?: string;
}

// ── Colour resolution ──────────────────────────────────────────────────────
// Ocean accent literals mirrored from constants/theme.ts `ocean` (not
// re-derived at runtime) so this stays a pure lookup, same approach as
// GlassSurface's FILL/HAIRLINE maps.
const ACCENT_HEX = '#4C8DF6';
const ACCENT_TINT = 'rgba(76,141,246,0.18)';        // between ocean.light (0.16) and the
                                                     // ~0.22 ceiling requested for the CTA fill
const ACCENT_BORDER = 'rgba(76,141,246,0.4)';
const ACCENT_RIPPLE = 'rgba(76,141,246,0.25)';

const DESTRUCTIVE_HEX = Colors.coral;               // '#FF6B6B' — "errors, destructive actions"
const DESTRUCTIVE_TINT = 'rgba(255,107,107,0.18)';
const DESTRUCTIVE_BORDER = 'rgba(255,107,107,0.45)';
const DESTRUCTIVE_RIPPLE = 'rgba(255,107,107,0.25)';

function resolveColors(
  variant: GlassButtonVariant,
  active: boolean,
  mode: 'dark' | 'light',
  tokens: { surface: string; separator: string; label2: string },
) {
  if (!active) {
    // Resting/unselected chip state — plain theme surface, same for both
    // variants (a resting chip never needs to look "destructive").
    return {
      fill: tokens.surface,
      border: tokens.separator,
      borderWidth: 1,
      text: tokens.label2,
      ripple: mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(20,18,28,0.08)',
    };
  }
  if (variant === 'destructive') {
    return {
      fill: DESTRUCTIVE_TINT,
      border: DESTRUCTIVE_BORDER,
      // Heavier border than primary — a non-colour cue so colourblind users
      // can distinguish "destructive" from "primary" without relying on hue
      // alone (WCAG 1.4.1, "use of colour").
      borderWidth: 2,
      text: DESTRUCTIVE_HEX,
      ripple: DESTRUCTIVE_RIPPLE,
    };
  }
  return {
    fill: ACCENT_TINT,
    border: ACCENT_BORDER,
    borderWidth: 1,
    text: ACCENT_HEX,
    ripple: ACCENT_RIPPLE,
  };
}

export function GlassButton({
  variant = 'primary',
  active: activeProp,
  label,
  icon,
  children,
  onPress,
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
}: GlassButtonProps) {
  const { mode, tokens } = useAppTheme();
  // `active` defaults to true (permanently-tinted CTA look). Whether the
  // caller passed it at all — not just its resolved value — matters for
  // accessibilityState below: only genuine toggle call sites (which pass
  // `active` explicitly) should announce `selected` to assistive tech; a
  // plain "Save"/"Submit" CTA is never conceptually "selected".
  const isToggle = activeProp !== undefined;
  const active = activeProp ?? true;
  const colors = resolveColors(variant, active, mode, tokens);

  // An explicit `accessibilityState` fully REPLACES the auto-computed one
  // (not a shallow merge) — needed so call sites that require a different
  // shape entirely (e.g. the age-range chips' checkbox role, which needs
  // `{ checked }` and never `selected`) get exactly what they ask for
  // rather than an auto `selected`/`disabled` key bleeding in alongside it.
  const resolvedAccessibilityState: AccessibilityState =
    accessibilityState ?? {
      disabled,
      ...(isToggle ? { selected: active } : {}),
    };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: colors.ripple }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={resolvedAccessibilityState}
      testID={testID}
      style={[
        {
          minHeight: 44,
          minWidth: 44,
          borderRadius: 14,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.fill,
          borderWidth: colors.borderWidth,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : children !== undefined ? (
        children
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          {label !== undefined && (
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 15, color: colors.text }}>
              {label}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
