// Tests for the Home "kids' mood" selector (components/home/MoodPicks.tsx).
// Covers: all moods render, items are pressable, selection + deselection via
// parent state, and accessibility labels. Selection is local UI state only — it
// does not assert any recommendation/query behaviour (there is none by design).

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MoodPicks } from '@/components/home/MoodPicks';
import { MOODS, type MoodId } from '@/lib/moods';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => 'light'),
}));

describe('MoodPicks', () => {
  it('renders all mood options', () => {
    const { getByText } = render(<MoodPicks selected={null} onSelect={jest.fn()} />);
    MOODS.forEach((m) => expect(getByText(m.label)).toBeTruthy());
    expect(MOODS.length).toBe(8);
  });

  it('exposes an accessibility label per mood', () => {
    const { getByLabelText } = render(<MoodPicks selected={null} onSelect={jest.fn()} />);
    MOODS.forEach((m) => expect(getByLabelText(m.label)).toBeTruthy());
  });

  it('calls onSelect with the mood id when pressed', () => {
    const onSelect = jest.fn();
    const { getByLabelText } = render(<MoodPicks selected={null} onSelect={onSelect} />);
    fireEvent.press(getByLabelText('Calm'));
    expect(onSelect).toHaveBeenCalledWith('calm');
  });

  it('marks the selected mood as selected', () => {
    const { getByLabelText } = render(<MoodPicks selected="calm" onSelect={jest.fn()} />);
    expect(getByLabelText('Calm, selected')).toBeTruthy();
  });

  it('supports select then deselect via parent toggle state', () => {
    function Wrapper() {
      const [sel, setSel] = React.useState<MoodId | null>(null);
      return <MoodPicks selected={sel} onSelect={(id) => setSel((p) => (p === id ? null : id))} />;
    }
    const { getByLabelText, queryByLabelText } = render(<Wrapper />);

    fireEvent.press(getByLabelText('Active'));
    expect(getByLabelText('Active, selected')).toBeTruthy();

    fireEvent.press(getByLabelText('Active, selected'));
    expect(queryByLabelText('Active, selected')).toBeNull();
    expect(getByLabelText('Active')).toBeTruthy();
  });
});
