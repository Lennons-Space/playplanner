/**
 * HelpModal — in-app dark v2 replacement for the old
 * `Alert.alert('Help', 'For help, email support@playplanner.app')` call.
 *
 * The native OS Alert.alert rendered as a plain grey Android dialog with no
 * relation to the app's dark v2 design language. This is a themed bottom
 * sheet instead, using the same GlassSurface + dark-token language as every
 * other v2 screen. It preserves the exact same support action (mailto to
 * support@playplanner.app) — only the presentation changed.
 *
 * Dismissal: backdrop tap, the "Close" button, and the Android hardware
 * back button (`onRequestClose`, wired automatically by RN's <Modal>) all
 * call the same onClose — there is exactly one way out, not several
 * inconsistent ones.
 *
 * Step 10A Part 2 (dual-theme foundation, proof set): tokens now come from
 * useAppTheme() instead of a hard-coded `Themes.dark`, so this modal follows
 * the resolved theme (dark unchanged from before; light gets a readable
 * white-surface sheet). Copy, structure, and the mailto/close/backdrop
 * handlers are byte-identical to before.
 */
import { useMemo } from 'react';
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { GlassButton } from '@/components/ui/GlassButton';
import { FontFamily, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

const SUPPORT_EMAIL = 'support@playplanner.app';

export interface HelpModalProps {
  visible: boolean;
  onClose: () => void;
}

export function HelpModal({ visible, onClose }: HelpModalProps) {
  const { tokens: T, accent: ACCENT } = useAppTheme();
  const styles = useMemo(() => createStyles(T, ACCENT), [T, ACCENT]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* accessibilityViewIsModal on the OUTER container, not just the sheet —
          it must wrap the backdrop dismiss button too, or screen readers (and
          RNTL's accessibility-aware queries) treat anything outside it as
          unreachable while the modal is open, silently breaking backdrop
          dismissal for assistive tech. */}
      <View style={styles.backdrop} testID="help-modal" accessibilityViewIsModal>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Dismiss Help dialog"
          accessibilityRole="button"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.iconBox}>
            <Icon name="info" size={22} color={ACCENT.accent} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Help & FAQ
          </Text>
          <Text style={styles.body}>
            For help with anything in PlayPlanner — finding venues, managing your
            account, or reporting a problem — email us and a real person will get
            back to you.
          </Text>
          <Text style={styles.email}>{SUPPORT_EMAIL}</Text>

          <GlassButton
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            accessibilityLabel={`Email support at ${SUPPORT_EMAIL}`}
            label="Contact us"
            style={styles.primaryBtnLayout}
          />

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Close Help dialog"
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(T: ThemeTokens, ACCENT: AccentPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: T.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: T.separator,
      borderBottomWidth: 0,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 36,
      alignItems: 'center',
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: T.label4,
      marginBottom: 18,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: ACCENT.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    title: {
      fontFamily: FontFamily.display,
      fontSize: 20,
      color: T.label,
      letterSpacing: -0.4,
      marginBottom: 10,
    },
    body: {
      fontFamily: FontFamily.body,
      fontSize: 14.5,
      color: T.label2,
      lineHeight: 21,
      textAlign: 'center',
      marginBottom: 12,
    },
    email: {
      fontFamily: FontFamily.bodyStrong,
      fontSize: 14.5,
      color: ACCENT.accent,
      marginBottom: 20,
    },
    // Phase 3 (glass button system): "Contact us" is now a <GlassButton/>;
    // only layout survives here.
    primaryBtnLayout: {
      width: '100%',
      borderRadius: 14,
      paddingVertical: 15,
      marginBottom: 10,
    },
    closeBtn: {
      width: '100%',
      paddingVertical: 13,
      alignItems: 'center',
    },
    closeBtnText: {
      fontFamily: FontFamily.bodyStrong,
      fontSize: 15,
      color: T.label3,
    },
  });
}
