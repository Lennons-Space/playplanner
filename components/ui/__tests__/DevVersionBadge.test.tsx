// Smoke coverage for DevVersionBadge — the DEV-ONLY on-screen build tag.
//
// Verifies: (1) it renders the DEV_VERSION string, (2) it never blocks
// touches (pointerEvents="none"), and (3) it is hidden from the
// accessibility tree (purely a visual dev aid, not a real UI control).
// __DEV__ is true under Jest, matching how this badge actually renders on a
// development build — the production no-op path (`if (!__DEV__) return
// null`) is simple enough to verify by inspection rather than by flipping a
// global Jest relies on internally.

import { render } from '@testing-library/react-native';

import { DevVersionBadge } from '@/components/ui/DevVersionBadge';
import { DEV_VERSION } from '@/constants/devVersion';

describe('DevVersionBadge', () => {
  it('renders the current DEV_VERSION string', () => {
    // accessibilityElementsHidden intentionally excludes this from the
    // default (accessibility-tree-aware) queries — read the raw tree instead.
    const root = render(<DevVersionBadge />).toJSON() as { children: string[] };
    expect(root.children).toContain(`PP ${DEV_VERSION}`);
  });

  it('is non-interactive (pointerEvents="none") and hidden from accessibility', () => {
    const root = render(<DevVersionBadge />).toJSON() as { props: Record<string, unknown> };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
