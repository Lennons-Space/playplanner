/**
 * Tests for components/ui/GlassSurface.tsx — the shared "dark glass" tint
 * primitive (Phase A of the v2 Light-theme correction).
 *
 * Covers: mode-aware fill + hairline border (dark values are UNCHANGED from
 * before this pass — rgba(14,14,20,0.82) fill / rgba(255,255,255,0.08)
 * hairline; light adds rgba(255,255,255,0.72) fill / rgba(20,18,28,0.08)
 * hairline), and that an explicitly-passed `tintColor` prop always wins over
 * the mode-resolved default, in both modes.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { GlassSurface } from '@/components/ui/GlassSurface';

const mockUseAppTheme = jest.fn();
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => mockUseAppTheme(),
}));

// Same mock shape used in app/(tabs)/__tests__/tabsLayout.test.tsx.
function themeFor(mode: 'dark' | 'light') {
  return {
    mode,
    tokens: {
      mode,
      bg: mode === 'dark' ? '#0C0C11' : '#F1F0F4',
      warm: mode === 'dark' ? '#0E0E14' : '#FBFAFC',
      surface: mode === 'dark' ? '#17171F' : '#FFFFFF',
      surface2: mode === 'dark' ? '#1F1F29' : '#F5F4F8',
      label: mode === 'dark' ? '#F4F4F6' : '#16151A',
      label2: mode === 'dark' ? 'rgba(235,235,245,0.76)' : 'rgba(20,18,28,0.74)',
      label3: mode === 'dark' ? 'rgba(235,235,245,0.44)' : 'rgba(20,18,28,0.48)',
      label4: mode === 'dark' ? 'rgba(235,235,245,0.22)' : 'rgba(20,18,28,0.26)',
      separator: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(20,18,28,0.10)',
      fill: mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(20,18,28,0.05)',
      fill2: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(20,18,28,0.03)',
      star: mode === 'dark' ? '#FFB23E' : '#FF9F0A',
      appBg: mode === 'dark' ? '#060608' : '#E4E3E8',
    },
    accent: { accent: '#4C8DF6', light: 'rgba(76,141,246,0.16)', tagText: '#82AEFA' },
  };
}

type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;

/** The tint/hairline sub-View is always the first child of the clip wrapper. */
function tintSubView(tree: JsonNode): { backgroundColor?: string; borderColor?: string } {
  const root = tree as unknown as { children: JsonNode[] };
  const tintNode = root.children[0] as unknown as { props: { style: unknown } };
  return StyleSheet.flatten(tintNode.props.style as never) as {
    backgroundColor?: string;
    borderColor?: string;
  };
}

beforeEach(() => {
  mockUseAppTheme.mockReset();
});

describe('GlassSurface — mode-aware fill + hairline', () => {
  it('renders the dark fill/hairline (unchanged literal values)', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    const tree = render(<GlassSurface />).toJSON() as JsonNode;
    const { backgroundColor, borderColor } = tintSubView(tree);
    expect(backgroundColor).toBe('rgba(14,14,20,0.82)');
    expect(borderColor).toBe('rgba(255,255,255,0.08)');
  });

  it('renders the light fill/hairline', () => {
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    const tree = render(<GlassSurface />).toJSON() as JsonNode;
    const { backgroundColor, borderColor } = tintSubView(tree);
    expect(backgroundColor).toBe('rgba(255,255,255,0.72)');
    expect(borderColor).toBe('rgba(20,18,28,0.08)');
  });

  it('an explicit tintColor prop wins over the dark default', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    const tree = render(<GlassSurface tintColor="rgba(1,2,3,0.5)" />).toJSON() as JsonNode;
    const { backgroundColor } = tintSubView(tree);
    expect(backgroundColor).toBe('rgba(1,2,3,0.5)');
  });

  it('an explicit tintColor prop wins over the light default', () => {
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    const tree = render(<GlassSurface tintColor="rgba(1,2,3,0.5)" />).toJSON() as JsonNode;
    const { backgroundColor } = tintSubView(tree);
    expect(backgroundColor).toBe('rgba(1,2,3,0.5)');
  });
});
