/**
 * ModerationBadge — pure display component.
 *
 * Shows the moderation status of a review or submitted venue as a
 * colour-coded pill badge. No logic, no side effects.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { ModerationStatus } from '@/types';
import { FontFamily } from '@/constants/theme';

interface ModerationBadgeProps {
  status: ModerationStatus;
}

const CONFIG: Record<ModerationStatus, { label: string; bg: string }> = {
  pending:  { label: 'Pending review', bg: '#FDCB6E' },
  approved: { label: 'Approved',       bg: '#00B894' },
  rejected: { label: 'Not approved',   bg: '#D63031' },
};

export function ModerationBadge({ status }: ModerationBadgeProps) {
  const { label, bg } = CONFIG[status];

  return (
    <View
      style={[styles.pill, { backgroundColor: bg }]}
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 11,
    color: '#FFFFFF',
  },
});

export default ModerationBadge;
