/**
 * DevVersionBadge — DEV-ONLY on-screen version tag.
 *
 * Lets a developer confirm on-device exactly which design iteration they're
 * looking at (and rules out stale-bundle confusion after a reload). Reads
 * DEV_VERSION from constants/devVersion.ts (bump that string manually per
 * iteration) — this component has no other logic.
 *
 * Safety:
 *  - Gated on `__DEV__` and returns null otherwise, so it can never render
 *    in a production/release build even if left mounted by mistake.
 *  - `pointerEvents="none"` — purely visual, never intercepts taps.
 *  - No personal, location or user data — just a static build string.
 */
import { Text } from 'react-native';

import { DEV_VERSION } from '@/constants/devVersion';

export function DevVersionBadge() {
  if (!__DEV__) return null;

  return (
    <Text
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        bottom: 14,
        right: 14,
        zIndex: 999,
        fontSize: 10,
        color: '#FFFFFF',
        opacity: 0.35,
        backgroundColor: 'rgba(0,0,0,0.25)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {`PP ${DEV_VERSION}`}
    </Text>
  );
}
