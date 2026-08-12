/**
 * PPBrandMark — the PlayPlanner compact brand mark (Home top-right).
 *
 * History (most recent first):
 *   - 2026-08-13: reverted to the compact map-only PP3 icon. The full PP2
 *     lockup stays Welcome-only; Home wants a small, subtle corner mark,
 *     not a wide lockup. Uses PP3-transparent.png (real alpha — no
 *     checkerboard/box behind it), never the raw PP3.png or any PP2 asset.
 *   - 2026-08-12: PP3 was bumped from a too-tiny first pass to a real,
 *     intentional visual/touch-target size — that "small but not tiny"
 *     sizing (default 50, square) is what this revert restores.
 * Also guards that the old isometric "cube tower" placeholder is fully gone.
 */
import React from 'react';
import { Image, Pressable } from 'react-native';
import { Polygon } from 'react-native-svg';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PPBrandMark } from '@/components/ui/PPBrandMark';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP3_TRANSPARENT_SOURCE = require('../../../assets/design/PP3-transparent.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP3_RAW_SOURCE = require('../../../assets/design/PP3.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP2_SOURCE = require('../../../assets/design/PP2.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP2_TRANSPARENT_SOURCE = require('../../../assets/design/PP2-transparent.png');

describe('PPBrandMark', () => {
  it('renders PP3-transparent.png (real alpha, no checkerboard) — never raw PP3.png or any PP2 asset', () => {
    render(<PPBrandMark />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props.source).toBe(PP3_TRANSPARENT_SOURCE);
    expect(image.props.source).not.toBe(PP3_RAW_SOURCE);
    expect(image.props.source).not.toBe(PP2_SOURCE);
    expect(image.props.source).not.toBe(PP2_TRANSPARENT_SOURCE);
  });

  it('uses resizeMode="contain" (no crop, no stretch)', () => {
    render(<PPBrandMark />);
    expect(screen.UNSAFE_getByType(Image).props.resizeMode).toBe('contain');
  });

  it('defaults to a small, subtle square icon (size 50) — not the wide PP2 lockup shape', () => {
    render(<PPBrandMark />);
    const style = screen.UNSAFE_getByType(Image).props.style;
    expect(style).toEqual({ width: 50, height: 50 });
    expect(style.width).toBeGreaterThanOrEqual(48); // clears the 48dp touch-target floor on its own
  });

  it('honours an explicit size prop and keeps it square', () => {
    render(<PPBrandMark size={64} />);
    const style = screen.UNSAFE_getByType(Image).props.style;
    expect(style).toEqual({ width: 64, height: 64 });
  });

  it('is not pressable (plain image) when no onPress is given', () => {
    render(<PPBrandMark />);
    expect(screen.UNSAFE_queryByType(Pressable)).toBeNull();
  });

  it('becomes a button with the given accessibility label and fires onPress when pressed', () => {
    const onPress = jest.fn();
    render(<PPBrandMark onPress={onPress} accessibilityLabel="Open profile" />);
    const button = screen.getByLabelText('Open profile');
    expect(button.props.accessibilityRole).toBe('button');
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('touch target clears 48dp via the icon size alone, with hitSlop as extra headroom', () => {
    const onPress = jest.fn();
    render(<PPBrandMark onPress={onPress} accessibilityLabel="Open profile" />);
    const button = screen.getByLabelText('Open profile');
    expect(button.props.hitSlop).toBeTruthy();
  });

  it('the old isometric cube tower geometry is gone (no SVG Polygon nodes)', () => {
    render(<PPBrandMark />);
    expect(screen.UNSAFE_queryAllByType(Polygon)).toHaveLength(0);
  });
});
