/**
 * V2Header — shared in-app header for pushed v2 dark screens.
 *
 * Every screen under app/profile/ (and app/venue/add.tsx) is pushed as a
 * plain Stack route with `headerShown: false` (see app/profile/_layout.tsx)
 * so there is never a native Expo Router header competing with this one —
 * exactly one deliberate header per screen, and no raw route-name fallback
 * title (the bug this component fixes: notifications.tsx and
 * privacy-settings.tsx previously had no <Stack.Screen options={{title}}>,
 * so Expo Router rendered the literal filename as a native header ABOVE
 * each screen's own custom header).
 *
 * Renders as a plain row — no card background — matching the "content
 * floats directly over the shared atmosphere" language already used by
 * Home/Venue Detail/Map, rather than the prototype's opaque surface-bar
 * header (pp2-profile.jsx `ProfileSubScreen`). Must be placed inside a
 * <SafeAreaView edges={['top']}> (or equivalent top inset) — it does not
 * add its own top safe-area padding.
 */
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Themes, FontFamily } from '@/constants/theme';

const T = Themes.dark;

export interface V2HeaderProps {
  title: string;
  /** Defaults to router.back(). Override for screens that need custom exit behaviour. */
  onBack?: () => void;
  /** Optional element rendered at the trailing edge (e.g. a save/skip action). */
  right?: React.ReactNode;
}

export function V2Header({ title, onBack, right }: V2HeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={onBack ?? (() => router.back())}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="chevL" size={20} color={T.label} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.trailing}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: T.fill,
    borderWidth: 1,
    borderColor: T.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontFamily: FontFamily.display,
    fontSize: 19,
    color: T.label,
    letterSpacing: -0.3,
  },
  trailing: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
});
