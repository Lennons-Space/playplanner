/**
 * HeroIllustration — Decorative SVG scene for the Welcome screen.
 *
 * Shows a sunny park day: soft-play building, trees, sun, clouds, flowers.
 * Built with react-native-svg so it scales to any device width.
 * Purely decorative — marked as non-accessible.
 */

import Svg, {
  Circle,
  Ellipse,
  G,
  Path,
  Polygon,
  Rect,
} from 'react-native-svg';
import { View } from 'react-native';

export function HeroIllustration() {
  return (
    <View
      style={{ width: '100%', height: 200 }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        viewBox="0 0 360 200"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
      >

        {/* ── Sky ─────────────────────────────────────────────────────────── */}
        <Rect x="0" y="0" width="360" height="200" fill="#D6EDFF" />

        {/* ── Sun (top-right) ──────────────────────────────────────────────── */}
        {/* Outer glow */}
        <Circle cx="312" cy="36" r="44" fill="#FFE66D" opacity="0.22" />
        {/* Mid glow */}
        <Circle cx="312" cy="36" r="33" fill="#FFE66D" opacity="0.35" />
        {/* Sun core */}
        <Circle cx="312" cy="36" r="24" fill="#FFE66D" />

        {/* ── Clouds ───────────────────────────────────────────────────────── */}
        {/* Cloud 1 — left */}
        <G opacity="0.92">
          <Ellipse cx="72"  cy="54" rx="30" ry="17" fill="white" />
          <Ellipse cx="50"  cy="62" rx="20" ry="15" fill="white" />
          <Ellipse cx="94"  cy="62" rx="22" ry="14" fill="white" />
        </G>
        {/* Cloud 2 — centre-right */}
        <G opacity="0.85">
          <Ellipse cx="228" cy="44" rx="22" ry="13" fill="white" />
          <Ellipse cx="211" cy="51" rx="16" ry="11" fill="white" />
          <Ellipse cx="245" cy="51" rx="17" ry="11" fill="white" />
        </G>

        {/* ── Rolling ground ───────────────────────────────────────────────── */}
        {/* Back hill — lighter green */}
        <Path
          d="M0 148 Q80 118 160 138 Q240 158 320 132 Q345 125 360 130 L360 200 L0 200 Z"
          fill="#9DD87A"
        />
        {/* Front hill — deeper green */}
        <Path
          d="M0 163 Q70 145 145 158 Q220 172 295 152 Q330 143 360 150 L360 200 L0 200 Z"
          fill="#7EC455"
        />

        {/* ── Left large tree ──────────────────────────────────────────────── */}
        {/* Trunk */}
        <Rect x="44" y="120" width="13" height="46" rx="3" fill="#A08060" />
        {/* Shadow canopy */}
        <Circle cx="51" cy="105" r="34" fill="#52A83A" />
        {/* Main canopy */}
        <Circle cx="51" cy="100" r="31" fill="#6DC24B" />
        {/* Highlight blob */}
        <Circle cx="44" cy="92"  r="16" fill="#88D865" opacity="0.55" />

        {/* ── Soft-play building (centre) ──────────────────────────────────── */}
        {/* Building body */}
        <Rect x="132" y="98" width="96" height="64" rx="4" fill="#FF6B6B" />
        {/* Roof shadow */}
        <Polygon points="124,98 180,64 236,98" fill="#D95555" />
        {/* Roof face */}
        <Polygon points="132,98 180,67 228,98" fill="#FF8585" />
        {/* Flag pole */}
        <Rect x="179" y="48" width="3" height="22" fill="#8C6E4B" />
        {/* Flag */}
        <Polygon points="182,48 196,55 182,62" fill="#FFE66D" />

        {/* Left window */}
        <Rect x="141" y="108" width="20" height="17" rx="3" fill="#74D4CC" />
        <Rect x="150" y="108" width="2"  height="17" fill="white" opacity="0.45" />
        <Rect x="141" y="116" width="20" height="2"  fill="white" opacity="0.45" />

        {/* Right window */}
        <Rect x="199" y="108" width="20" height="17" rx="3" fill="#74D4CC" />
        <Rect x="208" y="108" width="2"  height="17" fill="white" opacity="0.45" />
        <Rect x="199" y="116" width="20" height="2"  fill="white" opacity="0.45" />

        {/* Door */}
        <Rect x="165" y="133" width="24" height="29" rx="3" fill="#2D3436" opacity="0.22" />
        {/* Door knob */}
        <Circle cx="186" cy="149" r="2" fill="#2D3436" opacity="0.4" />

        {/* ── Right small tree ─────────────────────────────────────────────── */}
        {/* Trunk */}
        <Rect x="293" y="128" width="10" height="32" rx="2" fill="#A08060" />
        {/* Shadow canopy */}
        <Circle cx="298" cy="117" r="24" fill="#52A83A" />
        {/* Main canopy */}
        <Circle cx="298" cy="113" r="22" fill="#6DC24B" />
        {/* Highlight */}
        <Circle cx="292" cy="107" r="11" fill="#88D865" opacity="0.5" />

        {/* ── Path / walkway ───────────────────────────────────────────────── */}
        <Ellipse cx="180" cy="187" rx="40" ry="9" fill="#C8A97A" opacity="0.45" />

        {/* ── Ground flowers ───────────────────────────────────────────────── */}
        {/* Flower 1 */}
        <Circle cx="100" cy="167" r="4" fill="#FF9EAD" />
        <Circle cx="100" cy="161" r="3" fill="#FFB3C1" />
        {/* Flower 2 */}
        <Circle cx="116" cy="172" r="3" fill="#FFD6DD" />
        {/* Flower 3 */}
        <Circle cx="252" cy="160" r="4" fill="#FFE66D" />
        <Circle cx="252" cy="154" r="3" fill="#FFD700" />
        {/* Flower 4 */}
        <Circle cx="268" cy="167" r="3" fill="#FF9EAD" />

        {/* ── Small bird (top-left sky) ────────────────────────────────────── */}
        <Path
          d="M130 38 Q134 34 138 38"
          stroke="#A0B0C0"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M143 32 Q147 28 151 32"
          stroke="#A0B0C0"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />

      </Svg>
    </View>
  );
}
