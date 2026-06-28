/**
 * components/venue/VenueContactRow.tsx
 *
 * Presentational phone contact row for the venue detail screen.
 * Renders a tappable "Call" row when a valid phone number is stored,
 * or nothing at all when the phone field is absent/empty/digit-free.
 *
 * Kept separate from app/venue/[id].tsx so it can be tested in isolation
 * without mounting the full screen and all its hooks.
 *
 * SECURITY NOTE: Linking.openURL failures are caught so a device that cannot
 * handle tel: URIs cannot crash the screen; the user gets a brief Alert instead
 * of a silent dead tap.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Linking, Alert } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';

// ── Props ─────────────────────────────────────────────────────────────────────

interface VenueContactRowProps {
  /** Raw phone string as stored in the DB. Null/undefined → render nothing. */
  phone: string | null | undefined;
  /** Venue name used in the accessibility label. */
  venueName: string;
}

// ── sanitizePhoneForTel ───────────────────────────────────────────────────────

/**
 * Builds a dialable value suitable for use in a `tel:` URI scheme.
 *
 * Rules:
 *   - trim leading/trailing whitespace
 *   - preserve a single leading `+` (international format) if present
 *   - strip ALL non-digit characters from the remainder
 *   - return the dialable string only — caller prepends `tel:`
 *   - return empty string if there are no digits
 *
 * Examples:
 *   "+44 (0)20 7946 0958"  → "+442079460958"
 *   "(01228) 829570"       → "01228829570"
 *   "01228829570"          → "01228829570"
 */
export function sanitizePhoneForTel(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';

  const hasPlus = trimmed.startsWith('+');

  // When an international + prefix is present, strip the (0) trunk-code notation
  // that appears in some UK numbers (e.g. "+44 (0)20 …" → "+44 20 …").
  // This matches the spec example: "+44 (0)20 7946 0958" → "+442079460958".
  // For non-international numbers the leading brackets are just formatting and
  // the digit inside (e.g. "(01228)") must be preserved.
  const cleaned = hasPlus ? trimmed.replace(/\(0\)/g, '') : trimmed;

  const digitsOnly = cleaned.replace(/\D/g, '');

  if (!digitsOnly) return '';
  return hasPlus ? '+' + digitsOnly : digitsOnly;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a tappable "Call <phone>" row.
 *
 * Returns null and renders nothing when:
 *   - phone is null / undefined
 *   - phone trims to empty string
 *   - sanitize yields no dialable digits
 *
 * The stored phone string is displayed verbatim (human-readable form).
 * The sanitized value is used only for the tel: URI.
 *
 * No phone icon is available in the current design-system icon set
 * (Icon.tsx), so a bold "Call" text label is used instead.
 */
export function VenueContactRow({ phone, venueName }: VenueContactRowProps) {
  // Guard: absent or whitespace-only.
  if (!phone || !phone.trim()) return null;

  const dialable = sanitizePhoneForTel(phone);

  // Guard: no dialable digits (e.g. phone field contains only symbols).
  if (!dialable || !/\d/.test(dialable)) return null;

  const handlePress = () => {
    // A rejected/unsupported tel: URI must never crash the screen. Mirror the
    // screen's own Get-Directions pattern: tell the user why nothing happened
    // (e.g. a Wi-Fi-only tablet with no dialer) instead of a silent dead tap.
    Linking.openURL('tel:' + dialable).catch(() => {
      Alert.alert('Cannot start call', 'This device cannot make phone calls.');
    });
  };

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={`Call ${venueName} on ${phone}`}
      accessibilityHint="Opens your phone app to dial"
    >
      <Text style={styles.callLabel}>Call</Text>
      <Text style={styles.phoneText}>{phone}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Matches the address section visual language: same font family, similar size,
// and the muted label2 colour for the number (accent for the "Call" action cue).

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    marginBottom: 4,
  },
  callLabel: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 12,
    color: Colors.accent,
  },
  phoneText: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label2,
    lineHeight: 18,
  },
});
