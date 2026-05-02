// ─────────────────────────────────────────────────────────────────
// Icon.tsx — React Native re-implementation of icons.jsx
//
// Why react-native-svg?
//   The web design uses <svg> elements which don't exist in React Native.
//   react-native-svg provides Svg, Path, Circle, Rect etc. that render
//   natively on both iOS and Android. It is already installed.
//
// Why no VenueIllustration?
//   User decision: real venue photos only. The cartoon SVG scenes from the
//   design file are NOT ported. CategoryPlaceholder handles the no-photo case.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

// All icon names available in the design system.
// Keeping this as a union type means TypeScript will flag typos at call sites.
export type IconName =
  | 'map'
  | 'search'
  | 'heart'
  | 'heartFill'
  | 'user'
  | 'star'
  | 'starLine'
  | 'pin'
  | 'clock'
  | 'walk'
  | 'chevR'
  | 'chevL'
  | 'chevD'
  | 'close'
  | 'plus'
  | 'filter'
  | 'sliders'
  | 'share'
  | 'bell'
  | 'shield'
  | 'sparkle'
  | 'calendar'
  | 'settings'
  | 'mic'
  | 'check'
  | 'bookmark'
  | 'locate'
  | 'info'
  | 'chart'
  | 'msg'
  | 'biz'
  | 'wand'
  | 'arrow'
  | 'stroller'
  | 'leaf'
  | 'flame'
  | 'minus'
  | 'camera';

export interface IconProps {
  name: IconName;
  /** Rendered size in logical pixels (width and height). Default 20. */
  size?: number;
  /** Stroke/fill colour. Default '#1D2630' (pp-ink). */
  color?: string;
  /** SVG stroke width. Default 1.75. */
  strokeWidth?: number;
}

/**
 * Renders a single glyph from the PlayPlanner icon set.
 *
 * All icons are outlined (stroke-based) at 1.75 stroke weight unless noted.
 * `star` and `sparkle` are filled glyphs (no stroke) — consistent with the
 * design file where those two use fill={color} stroke="none".
 */
export function Icon({ name, size = 20, color = '#1D2630', strokeWidth = 1.75 }: IconProps) {
  // Common props shared by every <Svg> wrapper.
  // We set fill="none" globally; individual filled paths override with fill={color}.
  const svg = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'map':
      return (
        <Svg {...svg}>
          <Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
          <Path d="M9 4v14" />
          <Path d="M15 6v14" />
        </Svg>
      );

    case 'search':
      return (
        <Svg {...svg}>
          <Circle cx="11" cy="11" r="7" />
          <Path d="m20 20-3.5-3.5" />
        </Svg>
      );

    case 'heart':
      return (
        <Svg {...svg}>
          <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </Svg>
      );

    case 'heartFill':
      // Filled heart — used for saved/active state.
      return (
        <Svg {...svg} stroke="none">
          <Path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill={color}
          />
        </Svg>
      );

    case 'user':
      return (
        <Svg {...svg}>
          <Circle cx="12" cy="8" r="4" />
          <Path d="M4 21a8 8 0 0 1 16 0" />
        </Svg>
      );

    case 'star':
      // Filled star — used in ratings display.
      return (
        <Svg {...svg} stroke="none">
          <Path
            d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z"
            fill={color}
          />
        </Svg>
      );

    case 'starLine':
      // Outlined star — used for empty stars.
      return (
        <Svg {...svg}>
          <Path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z" />
        </Svg>
      );

    case 'pin':
      return (
        <Svg {...svg}>
          <Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
          <Circle cx="12" cy="10" r="3" />
        </Svg>
      );

    case 'clock':
      return (
        <Svg {...svg}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 7v5l3 2" />
        </Svg>
      );

    case 'walk':
      return (
        <Svg {...svg}>
          <Circle cx="13" cy="4" r="1.6" />
          <Path d="m7 22 2-6 3-2 3 4v4" />
          <Path d="m9 11 3-3 3 2 2 4" />
        </Svg>
      );

    case 'chevR':
      return (
        <Svg {...svg}>
          <Path d="m9 6 6 6-6 6" />
        </Svg>
      );

    case 'chevL':
      return (
        <Svg {...svg}>
          <Path d="m15 6-6 6 6 6" />
        </Svg>
      );

    case 'chevD':
      return (
        <Svg {...svg}>
          <Path d="m6 9 6 6 6-6" />
        </Svg>
      );

    case 'close':
      return (
        <Svg {...svg}>
          <Path d="M6 6l12 12M6 18 18 6" />
        </Svg>
      );

    case 'plus':
      return (
        <Svg {...svg}>
          <Path d="M12 5v14M5 12h14" />
        </Svg>
      );

    case 'filter':
      return (
        <Svg {...svg}>
          <Path d="M3 5h18M6 12h12M10 19h4" />
        </Svg>
      );

    case 'sliders':
      return (
        <Svg {...svg}>
          <Path d="M4 6h10M18 6h2" />
          <Circle cx="16" cy="6" r="2" />
          <Path d="M4 12h4M12 12h8" />
          <Circle cx="10" cy="12" r="2" />
          <Path d="M4 18h10M18 18h2" />
          <Circle cx="16" cy="18" r="2" />
        </Svg>
      );

    case 'share':
      return (
        <Svg {...svg}>
          <Circle cx="6" cy="12" r="2.5" />
          <Circle cx="18" cy="5" r="2.5" />
          <Circle cx="18" cy="19" r="2.5" />
          <Path d="m8 11 8-5M8 13l8 5" />
        </Svg>
      );

    case 'bell':
      return (
        <Svg {...svg}>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8z" />
          <Path d="M10 21a2 2 0 0 0 4 0" />
        </Svg>
      );

    case 'shield':
      return (
        <Svg {...svg}>
          <Path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6l-8-3z" />
        </Svg>
      );

    case 'sparkle':
      // Filled sparkle — used for sensory category and featured badges.
      return (
        <Svg {...svg} stroke="none">
          <Path
            d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17z"
            fill={color}
          />
        </Svg>
      );

    case 'calendar':
      return (
        <Svg {...svg}>
          <Rect x="3" y="5" width="18" height="16" rx="2" />
          <Path d="M8 3v4M16 3v4M3 10h18" />
        </Svg>
      );

    case 'settings':
      return (
        <Svg {...svg}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </Svg>
      );

    case 'mic':
      return (
        <Svg {...svg}>
          <Rect x="9" y="3" width="6" height="12" rx="3" />
          <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </Svg>
      );

    case 'check':
      return (
        <Svg {...svg}>
          <Path d="m5 12 5 5L20 7" />
        </Svg>
      );

    case 'bookmark':
      return (
        <Svg {...svg}>
          <Path d="M6 3h12v18l-6-4-6 4V3z" />
        </Svg>
      );

    case 'locate':
      return (
        <Svg {...svg}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </Svg>
      );

    case 'info':
      return (
        <Svg {...svg}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 11v5M12 8h.01" />
        </Svg>
      );

    case 'chart':
      return (
        <Svg {...svg}>
          <Path d="M3 20h18M6 16v-6M11 16V6M16 16v-9M21 16v-3" />
        </Svg>
      );

    case 'msg':
      return (
        <Svg {...svg}>
          <Path d="M4 5h16v11H8l-4 4V5z" />
        </Svg>
      );

    case 'biz':
      return (
        <Svg {...svg}>
          <Path d="M4 10V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
          <Rect x="3" y="10" width="18" height="11" rx="2" />
          <Path d="M9 10V6M15 10V6" />
        </Svg>
      );

    case 'wand':
      return (
        <Svg {...svg}>
          <Path d="m14 7 3 3L7 20l-3-3L14 7zM15 3v2M19 7h2M17 5l1.4 1.4" />
        </Svg>
      );

    case 'arrow':
      return (
        <Svg {...svg}>
          <Path d="M5 12h14M13 6l6 6-6 6" />
        </Svg>
      );

    case 'stroller':
      return (
        <Svg {...svg}>
          <Path d="M4 8a8 8 0 0 1 15 0H4z" />
          <Path d="M4 8v4h10l4-4" />
          <Circle cx="7" cy="18" r="2" />
          <Circle cx="15" cy="18" r="2" />
        </Svg>
      );

    case 'leaf':
      return (
        <Svg {...svg}>
          <Path d="M5 19c6 0 14-4 14-14 0 0-9 0-13 4s-1 10-1 10zM5 19l7-7" />
        </Svg>
      );

    case 'flame':
      return (
        <Svg {...svg}>
          <Path d="M12 2s6 5 6 11a6 6 0 0 1-12 0c0-3 2-4 2-6 0 2 1 3 2 3s-1-3 2-8z" />
        </Svg>
      );

    case 'minus':
      return (
        <Svg {...svg}>
          <Path d="M5 12h14" />
        </Svg>
      );

    case 'camera':
      return (
        <Svg {...svg}>
          <Path d="M4 8h4l2-2h4l2 2h4v12H4z" />
          <Circle cx="12" cy="14" r="4" />
        </Svg>
      );

    default:
      // Exhaustive check: TypeScript will warn if a new IconName is added
      // without a corresponding case. At runtime, render nothing rather than crash.
      return null;
  }
}
