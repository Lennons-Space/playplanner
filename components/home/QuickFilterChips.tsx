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
// • Chips scroll horizontally — never wrap.
// • Multiple chips can be active simultaneously (additive AND logic).
// • Tapping an active chip deselects it — no separate "clear" needed.
// • "All" chip is implicit: zero selection = no filtering.
//
// SAFETY:
// • Hard filters only show venues where the data is confirmed.
// • Soft filters use confident inference from category/age data.
// ─────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';
import { QUICK_FILTERS, type QuickFilterId } from '@/lib/quickFilters';

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
      <Text
        style={{
          fontFamily: FontFamily.heading,
          fontSize: 15,
          color: Colors.label,
          marginBottom: 10,
          paddingHorizontal: 20,
        }}
      >
        What are you looking for today?
      </Text>

      {/* Horizontal chip scroll. Fixed height prevents vertical clipping. */}
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
                  backgroundColor: active ? Colors.accent : Colors.surface,
                  borderWidth: 1,
                  borderColor: active ? Colors.accent : Colors.separator,
                  opacity: pressed ? 0.75 : 1,
                  shadowColor: Colors.label,
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: active ? 0 : 0.05,
                  shadowRadius: 2,
                  elevation: active ? 0 : 1,
                })}
              >
                <Text style={{ fontSize: 13 }}>{emoji}</Text>
                <Text
                  style={{
                    fontFamily: FontFamily.caption,
                    fontSize: 13,
                    color: active ? '#FFFFFF' : Colors.label,
                  }}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {selected.length > 0 && (
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <Text
            style={{
              fontFamily: FontFamily.body,
              fontSize: 12,
              color: Colors.label3,
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
