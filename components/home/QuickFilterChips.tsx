// ─────────────────────────────────────────────────────────────────
// QuickFilterChips — parent-friendly one-tap filter row.
//
// PRODUCT INTENT:
// Shown on the Home screen below QuickPicks. Parents tap one or more
// chips to express what they need ("rainy day + free") before tapping
// "Find something for us". The selection is passed as a URL param to
// the Results screen, which applies it after fetching venues.
//
// DESIGN:
// • Chips scroll horizontally — never wrap (wrapping creates decision
//   fatigue and is harder to scan).
// • Selected chips are tinted with the app's sky/teal colour.
// • Multiple chips can be active simultaneously (additive AND logic).
// • Tapping an active chip deselects it — no separate "clear" button
//   needed because the visual state makes it obvious.
// • "All" chip is implicit: zero selection = no filtering.
//
// SAFETY:
// • Hard filters (Free Entry, Has Cafe, Easy Parking, Accessible) only
//   show venues where the data is confirmed — never guesses.
// • Soft filters (Rainy Day, Toddlers, etc.) use confident inference
//   from category and age data — see lib/quickFilters.ts for the rules.
// ─────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { QUICK_FILTERS, type QuickFilterId } from '@/lib/quickFilters';

// Colour palette (matches the rest of the app; no new colours added).
const C = {
  ink: '#1D2630',
  mute: '#7B8794',
  paper: '#FFFFFF',
  line: '#E6E2DB',
  sky: '#4ECDC4',
  skyDeep: '#1B8A85',
  skySoft: '#D4F0EE',
} as const;

// Short emoji per filter — helps parents scan at a glance.
// Chosen to be recognisable and not childish.
const FILTER_EMOJI: Record<QuickFilterId, string> = {
  'rainy-day':       '☔',
  'free':            '🆓',
  'toddlers':        '🧸',
  'burn-energy':     '🏃',
  'outdoors':        '🌳',
  'indoors':         '🏠',
  'parent-friendly': '👶',
  'easy-parking':    '🅿️',
  'has-cafe':        '☕',
  'accessible':      '♿',
  'under-2-hours':   '⏱️',
};

export interface QuickFilterChipsProps {
  /** Currently selected filter IDs. */
  selected: QuickFilterId[];
  /** Called when the user toggles a chip. */
  onToggle: (id: QuickFilterId) => void;
}

export function QuickFilterChips({ selected, onToggle }: QuickFilterChipsProps) {
  const isSelected = useCallback(
    (id: QuickFilterId) => selected.includes(id),
    [selected],
  );

  return (
    <View>
      {/* Section title */}
      <Text
        style={{
          fontFamily: 'Nunito-ExtraBold',
          fontSize: 15,
          color: C.ink,
          marginBottom: 10,
          paddingHorizontal: 20,
        }}
      >
        What are you looking for today?
      </Text>

      {/* Horizontal chip scroll. The outer View with a fixed height is
          required to prevent the horizontal ScrollView from being
          vertically clipped by its flex parent. Without it, chip text
          can be cut off at top and bottom (same pattern as results.tsx). */}
      <View style={{ height: 44 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 20,
            gap: 8,
            alignItems: 'center',
            height: 44,
          }}
          style={{ flexGrow: 0 }}
          // Accessible: announce selection state via accessibilityState on each chip.
          accessibilityRole="toolbar"
          accessibilityLabel="Quick filters"
        >
          {QUICK_FILTERS.map((filter) => {
            const active = isSelected(filter.id);
            const emoji = FILTER_EMOJI[filter.id] ?? '';

            return (
              <Pressable
                key={filter.id}
                onPress={() => onToggle(filter.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${filter.label}${active ? ', selected' : ''}`}
                accessibilityHint={filter.description}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 13,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: active ? C.skyDeep : C.paper,
                  borderWidth: 1,
                  borderColor: active ? C.skyDeep : C.line,
                  opacity: pressed ? 0.75 : 1,
                  // Subtle shadow so chips feel slightly elevated.
                  shadowColor: '#1D2630',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: active ? 0 : 0.05,
                  shadowRadius: 2,
                  elevation: active ? 0 : 1,
                })}
              >
                <Text style={{ fontSize: 13 }}>{emoji}</Text>
                <Text
                  style={{
                    fontFamily: 'Nunito-Bold',
                    fontSize: 13,
                    color: active ? '#FFFFFF' : C.ink,
                  }}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Active filter hint — shown only when something is selected.
          Keeps the UI honest: parents know these are additional signals,
          not a guarantee (especially for soft filters). */}
      {selected.length > 0 && (
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <Text
            style={{
              fontFamily: 'Nunito-Regular',
              fontSize: 12,
              color: C.mute,
            }}
          >
            {selected.length === 1
              ? 'Filter applied — tap again to clear.'
              : `${selected.length} filters applied — tap any to clear.`}
          </Text>
        </View>
      )}
    </View>
  );
}
