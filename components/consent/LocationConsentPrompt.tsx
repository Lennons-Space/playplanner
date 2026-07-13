/**
 * LocationConsentPrompt — shown before the OS location permission dialog.
 *
 * ICO Children's Code Standard 10: users must understand WHY location is
 * needed and that it is OFF by default, before the OS dialog appears.
 *
 * `variant` is PURELY visual: 'light' (default) is the original skin used by
 * the legacy screens; 'dark' matches the Play Planner v2 dark theme and is
 * rendered by the v2 Map screen over its V2Background (transparent root so
 * the atmosphere shows through). Copy, button order, handlers, and
 * accessibility labels are identical in both variants — consent semantics
 * must never differ by theme.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Themes, ocean, FontFamily } from '@/constants/theme';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
  variant?: 'light' | 'dark';
}

const T = Themes.dark;

export function LocationConsentPrompt({ onAccept, onDecline, variant = 'light' }: Props) {
  const dark = variant === 'dark';
  return (
    <View
      className={dark ? undefined : 'flex-1 bg-slate items-center justify-center px-6'}
      style={dark ? s.darkRoot : undefined}
    >
      <Text
        className={dark ? undefined : 'text-2xl text-charcoal text-center mb-3'}
        style={dark ? s.darkTitle : { fontFamily: 'Nunito-ExtraBold' }}
      >
        Find venues near you?
      </Text>
      <Text
        className={dark ? undefined : 'text-base text-grey text-center mb-8'}
        style={dark ? s.darkBody : { fontFamily: 'Nunito-Regular' }}
      >
        {/*
          Wording note (GDPR Art.7 — informed consent):
          We must not claim location data is "never stored" or "not saved" —
          network requests and server logs may retain data briefly even when we
          do not store it ourselves. The accurate claim is that we do not store
          coordinates on our servers beyond what is needed to return results.
          ICO Children's Code Standard 10 requires transparency before consent.
        */}
        Play Planner would like to use your location to show nearby soft plays,
        parks, and cafes. Your device's location is used only to find venues near
        you — we do not store your coordinates on our servers.
        {'\n\n'}You can still browse venues without sharing your location — we'll show places across London instead. You can change this anytime in Settings.
      </Text>
      <TouchableOpacity
        className={dark ? undefined : 'w-full bg-sky rounded-2xl items-center justify-center mb-3'}
        style={dark ? [s.darkBtnBase, s.darkAccept] : { height: 52 }}
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel="Allow location access"
      >
        <Text
          className={dark ? undefined : 'text-white text-lg'}
          style={dark ? s.darkAcceptText : { fontFamily: 'Nunito-Bold' }}
        >
          Allow location
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className={dark ? undefined : 'w-full border-2 border-sky rounded-2xl items-center justify-center'}
        style={dark ? [s.darkBtnBase, s.darkDecline] : { height: 52 }}
        onPress={onDecline}
        accessibilityRole="button"
        accessibilityLabel="Browse without location"
      >
        <Text
          className={dark ? undefined : 'text-sky text-lg'}
          style={dark ? s.darkDeclineText : { fontFamily: 'Nunito-Bold' }}
        >
          Not now — browse without location
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// v2 dark skin — mirrors the accepted dark screens (Themes.dark + ocean).
const s = StyleSheet.create({
  darkRoot: {
    flex: 1,
    backgroundColor: 'transparent', // parent mounts V2Background behind
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  darkTitle: {
    fontFamily: FontFamily.display,
    fontSize: 24,
    letterSpacing: -0.5,
    color: T.label,
    textAlign: 'center',
    marginBottom: 12,
  },
  darkBody: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 23,
    color: T.label2,
    textAlign: 'center',
    marginBottom: 32,
  },
  darkBtnBase: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkAccept: {
    backgroundColor: ocean.accent,
    marginBottom: 12,
  },
  darkAcceptText: {
    fontFamily: FontFamily.caption,
    fontSize: 16,
    color: '#FFFFFF',
  },
  darkDecline: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
  },
  darkDeclineText: {
    fontFamily: FontFamily.caption,
    fontSize: 15,
    color: ocean.accent,
  },
});
