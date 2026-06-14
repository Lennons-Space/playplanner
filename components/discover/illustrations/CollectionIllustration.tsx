// ─────────────────────────────────────────────────────────────────────────
// CollectionIllustration — soft, single-stroke line-art used as the large faded
// background graphic on Discover cards (Headspace / Apple Weather feel).
//
// These replace the giant faded emojis. They are PURELY decorative: rendered at
// very low opacity by the card, never interactive, never announced to screen
// readers (the card's accessibilityLabel already conveys the collection).
//
// One stroke colour (the collection accent) so they read as gentle tinted
// texture at 0.02–0.05 opacity. Resolved by a plain string `illustrationKey`
// (kept presentation-agnostic in lib/collections) → no component lives in data.
// ─────────────────────────────────────────────────────────────────────────

import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';

export interface CollectionIllustrationProps {
  illustrationKey: string;
  size: number;
  /** Stroke colour — the collection accent. Opacity is applied by the card. */
  color: string;
}

const SW = 4.5;

export function CollectionIllustration({ illustrationKey, size, color }: CollectionIllustrationProps) {
  const s = { stroke: color, strokeWidth: SW, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  switch (illustrationKey) {
    // ── Summer (seasonal hero): sun · cloud · kite ──────────────────────────
    case 'summer':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Circle cx={40} cy={38} r={14} {...s} />
          <Line x1={40} y1={14} x2={40} y2={6} {...s} />
          <Line x1={40} y1={62} x2={40} y2={70} {...s} />
          <Line x1={16} y1={38} x2={8} y2={38} {...s} />
          <Line x1={64} y1={38} x2={72} y2={38} {...s} />
          <Line x1={23} y1={21} x2={17} y2={15} {...s} />
          <Line x1={57} y1={55} x2={63} y2={61} {...s} />
          <Line x1={57} y1={21} x2={63} y2={15} {...s} />
          <Line x1={23} y1={55} x2={17} y2={61} {...s} />
          {/* cloud */}
          <Path d="M38 92 q-13 0 -13 -12 q0 -12 13 -11 q3 -11 16 -8 q10 -6 17 5 q12 -1 11 12 q0 9 -12 9 Z" {...s} />
          {/* kite + tail */}
          <Path d="M88 18 l14 17 l-14 17 l-14 -17 Z" {...s} />
          <Path d="M88 52 q-6 9 1 14 q-8 5 -2 12" {...s} />
        </Svg>
      );

    // ── Burn Energy: flame · football · motion ─────────────────────────────
    case 'burn-energy':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Path d="M56 14 C72 34 77 47 66 62 C60 71 47 71 42 61 C38 53 45 47 48 41 C43 47 38 41 44 31 C49 39 51 27 56 14 Z" {...s} />
          <Circle cx={86} cy={88} r={13} {...s} />
          <Line x1={86} y1={75} x2={86} y2={101} {...s} />
          <Line x1={73} y1={88} x2={99} y2={88} {...s} />
          <Line x1={16} y1={42} x2={30} y2={42} {...s} />
          <Line x1={12} y1={56} x2={28} y2={56} {...s} />
          <Line x1={18} y1={70} x2={32} y2={70} {...s} />
        </Svg>
      );

    // ── Rainy Day: umbrella · raindrops ────────────────────────────────────
    case 'rainy-day':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Path d="M30 56 A28 28 0 0 1 86 56" {...s} />
          <Path d="M30 56 q7 11 14 0 q7 11 14 0 q7 11 14 0" {...s} />
          <Line x1={58} y1={56} x2={58} y2={88} {...s} />
          <Path d="M58 88 q0 9 -9 9 q-7 0 -7 -6" {...s} />
          <Path d="M40 74 q-4 6 0 8 q4 -2 0 -8 Z" {...s} />
          <Path d="M58 80 q-4 6 0 8 q4 -2 0 -8 Z" {...s} />
          <Path d="M76 74 q-4 6 0 8 q4 -2 0 -8 Z" {...s} />
        </Svg>
      );

    // ── Free Days Out: leaf · ticket ───────────────────────────────────────
    case 'free-days-out':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Path d="M34 60 C34 32 62 18 84 20 C84 48 58 64 34 60 Z" {...s} />
          <Path d="M42 54 C56 46 70 36 80 26" {...s} />
          <Rect x={22} y={78} width={46} height={24} rx={5} {...s} />
          <Line x1={50} y1={80} x2={50} y2={100} strokeDasharray="3 4" {...s} />
          <Circle cx={22} cy={90} r={3.5} {...s} />
          <Circle cx={68} cy={90} r={3.5} {...s} />
        </Svg>
      );

    // ── Hidden Gems: tree · winding path ───────────────────────────────────
    case 'hidden-gems':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Circle cx={68} cy={42} r={20} {...s} />
          <Line x1={68} y1={62} x2={68} y2={94} {...s} />
          <Path d="M22 100 C40 82 54 80 62 62" {...s} />
        </Svg>
      );

    // ── Generic leaf (spring / easter / autumn fallback) ───────────────────
    case 'leaf':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Path d="M30 86 C30 48 64 28 92 30 C92 66 58 88 30 86 Z" {...s} />
          <Path d="M40 78 C58 66 76 52 88 38" {...s} />
        </Svg>
      );

    // ── Snowflake (winter / christmas fallback) ────────────────────────────
    case 'snow':
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Line x1={60} y1={26} x2={60} y2={94} {...s} />
          <Line x1={31} y1={43} x2={89} y2={77} {...s} />
          <Line x1={89} y1={43} x2={31} y2={77} {...s} />
          <Path d="M60 34 l-7 7 M60 34 l7 7 M60 86 l-7 -7 M60 86 l7 -7" {...s} />
        </Svg>
      );

    default:
      // Unknown key → a calm leaf so a card never renders empty decoration.
      return (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Path d="M30 86 C30 48 64 28 92 30 C92 66 58 88 30 86 Z" {...s} />
          <Path d="M40 78 C58 66 76 52 88 38" {...s} />
        </Svg>
      );
  }
}
