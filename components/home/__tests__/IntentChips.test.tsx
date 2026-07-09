/**
 * IntentChips — the Home intent rail, rebuilt (2026-07-09) as designed
 * button cards after on-device feedback that plain emoji pills read as
 * "loose emojis and text".
 *
 * Guards here:
 *   - every intent renders as a real button CARD: visible surface container
 *     (bg + border + radius) with a 38×38 tinted rounded-square icon tile
 *     and a label + sub-label column — never bare emoji text;
 *   - styles are STATIC objects (the device NativeWind interop drops
 *     style-as-function props, which is what un-styled the old pills);
 *   - selected state is obvious and accessible (accessibilityState.selected,
 *     tinted fill, intent-colour ring);
 *   - toggling works and the inline Clear card appears only while active.
 */

import { StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import { IntentChips } from '../IntentChips';
import { INTENTS } from '@/lib/homeIntents';

describe('IntentChips — designed card buttons', () => {
  it('renders every intent as a button card with icon tile + label + sub-label', () => {
    const { getByTestId } = render(
      <IntentChips active={null} onToggle={jest.fn()} onClear={jest.fn()} />,
    );

    for (const intent of INTENTS) {
      const card = getByTestId(`intent-chip-${intent.key}`);
      expect(card.props.accessibilityRole).toBe('button');

      // Visible card container — surface fill, hairline ring, rounded.
      const cardStyle = StyleSheet.flatten(card.props.style);
      expect(cardStyle.backgroundColor).toBe('#17171F');
      expect(cardStyle.borderWidth).toBe(1);
      expect(cardStyle.borderRadius).toBe(15);
      expect(cardStyle.flexDirection).toBe('row');

      // Icon tile — 34×34 rounded square, tinted in the intent colour.
      const tile = within(card).getByTestId(`intent-chip-tile-${intent.key}`);
      const tileStyle = StyleSheet.flatten(tile.props.style);
      expect(tileStyle.width).toBe(34);
      expect(tileStyle.height).toBe(34);
      expect(tileStyle.borderRadius).toBe(11);
      expect(tileStyle.backgroundColor).toMatch(/^rgba\(/);
      expect(within(tile).getByText(intent.emoji)).toBeTruthy();

      // Label + sub-label both present (not bare emoji).
      expect(within(card).getByText(intent.label)).toBeTruthy();
      expect(within(card).getByText(intent.sub)).toBeTruthy();
    }
  });

  it('marks the active intent selected with a tinted fill and intent-colour ring', () => {
    const activeKey = INTENTS[0].key;
    const { getByTestId } = render(
      <IntentChips active={activeKey} onToggle={jest.fn()} onClear={jest.fn()} />,
    );

    const activeCard = getByTestId(`intent-chip-${activeKey}`);
    expect(activeCard.props.accessibilityState).toEqual({ selected: true });
    const activeStyle = StyleSheet.flatten(activeCard.props.style);
    expect(activeStyle.borderWidth).toBe(1.5);
    expect(activeStyle.backgroundColor).toMatch(/^rgba\(/); // intent tint, not surface

    const idleCard = getByTestId(`intent-chip-${INTENTS[1].key}`);
    expect(idleCard.props.accessibilityState).toEqual({ selected: false });
    expect(StyleSheet.flatten(idleCard.props.style).backgroundColor).toBe('#17171F');
  });

  it('toggles on press', () => {
    const onToggle = jest.fn();
    const { getByTestId } = render(
      <IntentChips active={null} onToggle={onToggle} onClear={jest.fn()} />,
    );
    fireEvent.press(getByTestId(`intent-chip-${INTENTS[2].key}`));
    expect(onToggle).toHaveBeenCalledWith(INTENTS[2].key);
  });

  it('shows the inline Clear card only while an intent is active, and clears on press', () => {
    const onClear = jest.fn();
    const { queryByTestId, getByTestId, rerender } = render(
      <IntentChips active={null} onToggle={jest.fn()} onClear={onClear} />,
    );
    expect(queryByTestId('intent-clear')).toBeNull();

    rerender(<IntentChips active={INTENTS[0].key} onToggle={jest.fn()} onClear={onClear} />);
    fireEvent.press(getByTestId('intent-clear'));
    expect(onClear).toHaveBeenCalled();
  });
});
