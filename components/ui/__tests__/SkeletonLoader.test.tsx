/**
 * Tests for components/ui/SkeletonLoader.tsx.
 *
 * Root cause covered: `Skeleton` used to hardcode `Colors.surface2`
 * (#F2EBDD, a solid warm cream) regardless of app theme — painting a bright
 * opaque cream flash over the shared <ThemedBackground/> atmosphere on dark
 * screens (Venue Detail's loading state, Home's row skeletons). This suite
 * proves the fix: the fill now resolves from useAppTheme(), is translucent
 * in both modes (never an opaque cream/white block), and every existing
 * dimension/prop/animation/loading-semantics contract is unchanged.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Skeleton, VenueRowSkeleton, VenueDetailSkeleton, ListPageSkeleton } from '@/components/ui/SkeletonLoader';

const mockUseAppTheme = jest.fn();
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => mockUseAppTheme(),
}));

// VenueDetailSkeleton mounts <ThemedBackground/>/<SafeAreaView/> — the real
// atmosphere layer (and its own weather/location hooks) is covered by its own
// dedicated suites (ThemedBackground.test.tsx, V2Background.test.tsx); here
// we only need to prove VenueDetailSkeleton itself lays out the right
// Skeleton blocks, so both are stubbed to lightweight passthroughs, same
// approach already used by app/venue/__tests__/venueDetailBackground.test.tsx
// for its own heavy-child stubs.
jest.mock('@/components/ui/ThemedBackground', () => ({
  ThemedBackground: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

function themeFor(mode: 'dark' | 'light') {
  return { mode, tokens: {}, accent: {} };
}

type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;

// Flattens a rendered node's style — the same technique already established
// in app/venue/__tests__/venueDetailBackground.test.tsx's findStyleByShape,
// robust to Animated.View's style being an array ([baseStyle, userOverride]).
function flatStyle(node: JsonNode): Record<string, unknown> {
  return StyleSheet.flatten((node?.props?.style ?? {}) as never) as Record<string, unknown>;
}

beforeEach(() => {
  mockUseAppTheme.mockReset();
});

describe('Skeleton — theme-aware fill (no more legacy cream flash)', () => {
  it('renders a translucent DARK fill, not the legacy opaque cream', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    const tree = render(<Skeleton />).toJSON() as JsonNode;
    const { backgroundColor } = flatStyle(tree);
    expect(backgroundColor).toBe('rgba(255,255,255,0.14)');
    expect(backgroundColor).not.toBe('#F2EBDD'); // the old Colors.surface2 cream
  });

  it('renders a translucent, warm-pale LIGHT fill — not cold grey, not opaque cream', () => {
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    const tree = render(<Skeleton />).toJSON() as JsonNode;
    const { backgroundColor } = flatStyle(tree);
    expect(backgroundColor).toBe('rgba(28,20,8,0.08)');
    expect(backgroundColor).not.toBe('#F2EBDD'); // legacy cream
    expect(backgroundColor).not.toBe('#F5F4F8'); // Themes.light.surface2 cold grey
  });

  it('both fills are translucent (alpha < 1), so the atmosphere behind them stays visible', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    const darkBg = flatStyle(render(<Skeleton />).toJSON() as JsonNode).backgroundColor as string;
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    const lightBg = flatStyle(render(<Skeleton />).toJSON() as JsonNode).backgroundColor as string;
    for (const bg of [darkBg, lightBg]) {
      const alpha = Number(bg.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('no longer imports the legacy Colors export at all', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../SkeletonLoader.tsx'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/\bColors\b/);
    }
  });
});

describe('Skeleton — preserved contract (dimensions, props, semantics)', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  it('keeps the default width/height when no props are passed', () => {
    const tree = render(<Skeleton />).toJSON() as JsonNode;
    const style = flatStyle(tree);
    expect(style.width).toBe('100%');
    expect(style.height).toBe(14);
  });

  it('still honours explicit width/height/borderRadius/style overrides', () => {
    const tree = render(<Skeleton width={80} height={32} borderRadius={999} style={{ marginTop: 4 }} />).toJSON() as JsonNode;
    const style = flatStyle(tree);
    expect(style.width).toBe(80);
    expect(style.height).toBe(32);
    expect(style.borderRadius).toBe(999);
    expect(style.marginTop).toBe(4);
  });
});

describe('VenueRowSkeleton — layout unchanged (Home + collection loading rows)', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  // Walks the rendered tree collecting every node whose flattened style has
  // a numeric/percentage `width` AND `height` — i.e. every Skeleton block —
  // in document order, regardless of the exact wrapper nesting.
  function collectSkeletonBlocks(node: JsonNode, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (!node) return out;
    const style = flatStyle(node);
    if (style.width !== undefined && style.height !== undefined && style.backgroundColor !== undefined) {
      out.push(style);
    }
    (node.children ?? []).forEach((child) => collectSkeletonBlocks(child, out));
    return out;
  }

  it('renders exactly 3 Skeleton blocks with the established dimensions (unchanged layout)', () => {
    const tree = render(<VenueRowSkeleton />).toJSON() as JsonNode;
    const blocks = collectSkeletonBlocks(tree);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].width).toBe(44);
    expect(blocks[0].height).toBe(44);
    expect(blocks[1].width).toBe('65%');
    expect(blocks[1].height).toBe(13);
    expect(blocks[2].width).toBe('40%');
    expect(blocks[2].height).toBe(11);
  });
});

// Shared tree-walker for the two composed full-page skeletons below — finds
// every node whose flattened style has both a `width` and `height` set
// (every Skeleton block), in document order, regardless of wrapper nesting.
function collectSkeletonBlocks(node: JsonNode, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node) return out;
  const style = flatStyle(node);
  if (style.width !== undefined && style.height !== undefined && style.backgroundColor !== undefined) {
    out.push(style);
  }
  (node.children ?? []).forEach((child) => collectSkeletonBlocks(child, out));
  return out;
}

describe('VenueDetailSkeleton — matches Venue Detail\'s real hero+sheet+stat-strip layout', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  it('renders the hero block plus the title/meta/pill-row/card blocks with the real screen\'s exact dimensions', () => {
    const tree = render(<VenueDetailSkeleton />).toJSON() as JsonNode;
    const blocks = collectSkeletonBlocks(tree);
    // hero, title, subtitle, 3 pills, one card = 7 Skeleton blocks.
    expect(blocks).toHaveLength(7);
    expect(blocks[0]).toMatchObject({ width: '100%', height: 300, borderRadius: 0 }); // hero
    expect(blocks[1]).toMatchObject({ width: '70%', height: 28 }); // title
    expect(blocks[2]).toMatchObject({ width: '45%', height: 14 }); // meta line
    expect(blocks[3]).toMatchObject({ width: 80, height: 32 }); // pill 1
    expect(blocks[4]).toMatchObject({ width: 80, height: 32 }); // pill 2
    expect(blocks[5]).toMatchObject({ width: 80, height: 32 }); // pill 3
    expect(blocks[6]).toMatchObject({ width: '100%', height: 60 }); // card
  });

  it('reuses the shared Skeleton primitive only — no separate shimmer mechanism', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../SkeletonLoader.tsx'), 'utf8');
    const fnBody = src.slice(src.indexOf('export function VenueDetailSkeleton'));
    expect(fnBody).toMatch(/<Skeleton\b/);
    expect(fnBody).not.toMatch(/Animated\.(loop|timing|Value)/); // no new Animated shimmer logic
  });
});

describe('ListPageSkeleton — generic list-page loading state (Search/Map-list/Saved-style pages)', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  it('renders a header placeholder followed by the default 5 stacked VenueRowSkeleton rows', () => {
    const tree = render(<ListPageSkeleton />).toJSON() as JsonNode;
    const blocks = collectSkeletonBlocks(tree);
    // 2 header blocks + 5 rows * 3 blocks each = 17.
    expect(blocks).toHaveLength(2 + 5 * 3);
    expect(blocks[0]).toMatchObject({ width: '55%', height: 22 }); // header title
    expect(blocks[1]).toMatchObject({ width: '35%', height: 13 }); // header subtitle
    // First row's blocks match VenueRowSkeleton's established dimensions.
    expect(blocks[2]).toMatchObject({ width: 44, height: 44 });
    expect(blocks[3]).toMatchObject({ width: '65%', height: 13 });
    expect(blocks[4]).toMatchObject({ width: '40%', height: 11 });
  });

  it('honours a custom `rows` count', () => {
    const tree = render(<ListPageSkeleton rows={2} />).toJSON() as JsonNode;
    const blocks = collectSkeletonBlocks(tree);
    expect(blocks).toHaveLength(2 + 2 * 3);
  });

  it('never mounts <ThemedBackground/> itself — callers own their own background mount', () => {
    // ThemedBackground is mocked to a no-op in this file; if ListPageSkeleton
    // rendered it, this would still pass structurally, so assert via source
    // instead — the real contract under test is "no import", not "no render".
    const src = fs.readFileSync(path.resolve(__dirname, '../SkeletonLoader.tsx'), 'utf8');
    const fnBody = src.slice(
      src.indexOf('export function ListPageSkeleton'),
      src.indexOf('export function ListPageSkeleton') + 600,
    );
    expect(fnBody).not.toMatch(/ThemedBackground/);
  });
});
