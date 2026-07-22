/**
 * DevWeatherTester — __DEV__-ONLY manual weather/atmosphere test harness.
 *
 * Opened via a 500ms+ long-press on Home's weather pill (app/(tabs)/index.tsx
 * — the long-press handler itself only exists behind an `if (__DEV__)`
 * branch there, so this modal is never reachable in a production build).
 *
 * Overrides the resolved WeatherCondition (+ optionally forces night) via
 * store/devWeatherStore.ts, the SAME shared source hooks/useResolvedWeather.ts
 * (which itself wraps hooks/useWeather.ts) and components/ui/V2Background.tsx
 * read — so every screen that mounts <ThemedBackground/> updates immediately,
 * with no navigation reset and no per-screen wiring, exactly the
 * shared-source reactivity the accepted animation architecture already
 * relies on (wall-clock useLoop + one query cache key per resolved
 * location). This file adds no new animation clock and never touches
 * WeatherLayer.tsx/loopPhaseAt.
 *
 * PRIVACY: shows NO coordinates, NO postcode, NO user identity — only a
 * boolean "consented location vs generic fallback" provenance flag (see
 * `usingConsentedLocation` below). Nothing in this file ever logs to the
 * console; it only reads/writes the in-memory devWeatherStore and renders
 * plain text.
 */
import { Modal, View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useDevWeatherStore } from '@/store/devWeatherStore';
import { useAppTheme } from '@/hooks/useAppTheme';
import { resolveAtmosphere, isNightNow } from '@/lib/weatherTheme';
import type { WeatherCondition, WeatherState } from '@/lib/weather';

export interface DevWeatherTesterProps {
  visible: boolean;
  onClose: () => void;
  /** The CURRENTLY RESOLVED condition (live or overridden) — same value the rest of the screen reads. */
  resolvedCondition: WeatherCondition | null;
  /** The full resolved WeatherState (live or overridden), for the diagnostic readout. */
  weather: WeatherState | null;
  /**
   * True when the resolved weather is using the user's ALREADY-CONSENTED
   * coarse location (hooks/useResolvedWeather.ts), false when it's the
   * generic FALLBACK_LOCATION (pre-consent, declined, or no cached fix yet).
   * NEVER a coordinate — this is a boolean provenance flag only, so this
   * modal can stay honest about which source is live without ever reading
   * or rendering a location value.
   */
  usingConsentedLocation: boolean;
}

// `condition: null` on the first row means "clear the override" (Live
// weather), not the WeatherCondition 'clear' — that's the SEPARATE "Clear"
// row below it (sunny/clear sky).
const OPTIONS: { label: string; condition: WeatherCondition | null }[] = [
  { label: 'Live weather (reset)', condition: null },
  { label: 'Clear', condition: 'clear' },
  // WMO 1 "mainly clear" — kept DISTINCT from both 'Clear' (WMO 0) and
  // 'Partly cloudy' (WMO 2) since 2026-07-19 (see lib/weather.ts
  // classifyCondition) — predominantly sunny, restrained cloud accents only.
  { label: 'Mainly clear', condition: 'mainly_clear' },
  { label: 'Partly cloudy', condition: 'partly_cloudy' },
  { label: 'Overcast', condition: 'overcast' },
  { label: 'Mist / fog', condition: 'fog' },
  { label: 'Drizzle', condition: 'drizzle' },
  { label: 'Rain', condition: 'rain' },
  // No separate "heavy rain" visual/condition exists in this app (see
  // lib/weather.ts classifyCondition) — honestly maps to the SAME 'rain'
  // condition rather than inventing a new one.
  { label: 'Rain (heavy)', condition: 'rain' },
  { label: 'Showers', condition: 'showers' },
  { label: 'Snow', condition: 'snow' },
  { label: 'Thunderstorm', condition: 'thunderstorm' },
];

export function DevWeatherTester({
  visible,
  onClose,
  resolvedCondition,
  weather,
  usingConsentedLocation,
}: DevWeatherTesterProps) {
  const { mode } = useAppTheme();
  const override = useDevWeatherStore((s) => s.override);
  const forceNight = useDevWeatherStore((s) => s.forceNight);
  const setOverride = useDevWeatherStore((s) => s.setOverride);
  const setForceNight = useDevWeatherStore((s) => s.setForceNight);
  const clear = useDevWeatherStore((s) => s.clear);

  const night = forceNight !== null ? forceNight : isNightNow();
  const atmosphere = resolveAtmosphere(resolvedCondition, night);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="dev-weather-tester-sheet">
          <Text style={styles.title}>DEV — Weather tester</Text>
          <Text style={styles.subtitle}>Manual visual QA only. Never shown in a production build.</Text>

          <ScrollView style={styles.optionsScroll}>
            {OPTIONS.map((opt) => {
              const isActive = opt.condition === null ? override === null : override === opt.condition;
              return (
                <Pressable
                  key={opt.label}
                  onPress={() => (opt.condition === null ? clear() : setOverride(opt.condition))}
                  style={[styles.row, isActive && styles.rowActive]}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={styles.rowText}>{opt.label}</Text>
                  {isActive && <Text style={styles.rowBadge}>ACTIVE</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.toggleRow}>
            <Text style={styles.rowText}>Force night</Text>
            <Switch
              value={forceNight === true}
              onValueChange={(v) => setForceNight(v ? true : null)}
              accessibilityLabel="Force night"
              accessibilityRole="switch"
            />
          </View>

          <View style={styles.diagnostics} testID="dev-weather-tester-diagnostics">
            <Text style={styles.diagLine}>Live vs Overridden: {override ? 'OVERRIDDEN' : 'Live'}</Text>
            <Text style={styles.diagLine}>Raw weathercode: {weather?.weathercode ?? '— (not a live reading)'}</Text>
            <Text style={styles.diagLine}>Mapped condition: {resolvedCondition ?? '—'}</Text>
            <Text style={styles.diagLine}>Day / night (resolved): {night ? 'Night' : 'Day'}</Text>
            <Text style={styles.diagLine}>Theme mode: {mode}</Text>
            <Text style={styles.diagLine}>Resolved atmosphere: {atmosphere}</Text>
            {/* NEVER a coordinate — a provenance flag only. Both values stay
                explicitly "(non-personal)": even the consented-location branch
                only ever carries a rounded ~11km-precision reading, is never
                displayed as a number here, and is never logged anywhere. */}
            <Text style={styles.diagLine}>
              Location source: {usingConsentedLocation ? 'consented coarse location (non-personal)' : 'coarse fallback, pre-consent (non-personal)'}
            </Text>
          </View>

          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close weather tester">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A1A22', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 10 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 },
  optionsScroll: { maxHeight: 320 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowActive: { backgroundColor: 'rgba(76,141,246,0.15)' },
  rowText: { color: '#FFFFFF', fontSize: 14 },
  rowBadge: { color: '#4C8DF6', fontSize: 11, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  diagnostics: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  diagLine: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'monospace' },
  closeBtn: { marginTop: 4, alignItems: 'center', paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10 },
  closeBtnText: { color: '#FFFFFF', fontWeight: '600' },
});
