/**
 * FilterSheet.tsx
 *
 * A slide-up filter panel that lets parents filter nearby venues by category,
 * price, age range, distance, and whether they are open right now.
 *
 * --- Why no @gorhom/bottom-sheet ---
 * The gorhom library depends on react-native-reanimated, which requires a
 * native TurboModule compiled into the app binary. That crashes Expo Go.
 * Instead we use React Native's built-in Modal + Animated — zero native
 * module dependencies, works in Expo Go out of the box.
 *
 * --- How the animation works ---
 * We keep a `translateY` Animated.Value. When `visible` becomes true we
 * spring it from SHEET_HEIGHT (off-screen below) to 0 (fully visible).
 * When `visible` becomes false we spring it back down, then call onClose
 * once the animation settles so the parent can clear state cleanly.
 *
 * --- Filter state ---
 * Filter state lives in Zustand (filterStore). We keep a local draft copy
 * while the sheet is open so the user can change values without immediately
 * affecting the live map. Tapping Apply commits the draft to the store.
 * Tapping Reset clears the store and the draft back to defaults.
 *
 * --- Props ---
 *   visible  — controlled by the parent; true = sheet is open
 *   onClose  — called when the sheet should close (overlay tap, Apply, Reset)
 *
 * Sections:
 *   1. Categories   — multi-select chips, fetched from Supabase
 *   2. Price        — multi-select chips (free / budget / moderate / premium)
 *   3. Age range    — +/- steppers for Min Age and Max Age (0–18, nullable)
 *   4. Distance     — single-select preset row (1 / 5 / 10 / 25 km)
 *   5. Open now     — toggle switch
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useFilterStore } from '@/store/filterStore';
import { Colors } from '@/constants/theme';
import type { Category, Facility, PriceRange, VenueFilters } from '@/types';
import { DEFAULT_FILTERS } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FilterSheetProps {
  /** When true the sheet slides into view. The parent controls this. */
  visible: boolean;
  /** Called when the sheet wants to close (overlay tap, Apply, Reset). */
  onClose: () => void;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Fetches the list of categories from Supabase (id, name, slug, icon, color). */
async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, icon, color')
    .order('name');

  if (error) throw error;
  // The generated Supabase client types data as any[] — assert to our known shape.
  return (data ?? []) as Category[];
}

/** Fetches the list of facilities from Supabase (id, name, slug, icon). */
async function fetchFacilities(): Promise<Facility[]> {
  const { data, error } = await supabase
    .from('facilities')
    .select('id, name, slug, icon')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Facility[];
}

// ─── Price chip config ────────────────────────────────────────────────────────

const PRICE_OPTIONS: { value: PriceRange; label: string }[] = [
  { value: 'free',     label: 'Free'     },
  { value: 'budget',   label: 'Budget'   },
  { value: 'moderate', label: 'Moderate' },
  { value: 'premium',  label: 'Premium'  },
];

// ─── Distance preset config ───────────────────────────────────────────────────

// Displayed in miles (what UK parents expect); stored internally as km.
// 5 mi=8km, 10 mi=16km, 20 mi=32km, 30 mi=48km.
// 32km (20 mi) matches DEFAULT_FILTERS.maxDistanceKm so selecting it
// does not increment the active-filter badge.
const DISTANCE_OPTIONS = [
  { miles: 5,  km: 8  },
  { miles: 10, km: 16 },
  { miles: 20, km: 32 },
  { miles: 30, km: 48 },
] as const;

// ─── Age stepper limits ───────────────────────────────────────────────────────

const MIN_AGE_LIMIT = 0;
const MAX_AGE_LIMIT = 18;

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A single selectable chip (used for categories, price, and distance).
 * Selected state uses the coral brand colour; unselected is sand with a border.
 */
const Chip = memo(function Chip({
  label,
  selected,
  onPress,
  icon,
  accentColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: string;
  accentColor?: string;
}) {
  const bg = selected ? (accentColor ?? Colors.sky) : Colors.sandDark;
  const textColor = selected ? Colors.white : Colors.charcoal;
  const borderColor = selected ? 'transparent' : Colors.greyLighter;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        borderColor,
        borderWidth: 1.5,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginRight: 8,
        marginBottom: 4,
        gap: 4,
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
    >
      {icon ? (
        <Text style={{ fontSize: 15 }}>{icon}</Text>
      ) : null}
      <Text style={{ color: textColor, fontFamily: 'Nunito-Bold', fontSize: 13 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * A +/- numeric stepper for age inputs.
 * When the value would go below `min`, we set it to null ("Any age").
 */
const AgeStepper = memo(function AgeStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
}) {
  const displayed = value ?? min; // show min when null (unset)

  function increment() {
    const next = displayed + 1;
    onChange(next > max ? max : next);
  }

  function decrement() {
    const next = displayed - 1;
    // Going below min means "clear this filter" — set to null
    if (next < min) {
      onChange(null);
      return;
    }
    onChange(next);
  }

  return (
    <View style={{ alignItems: 'center', flex: 1, gap: 6 }}>
      <Text style={{ color: Colors.grey, fontFamily: 'Nunito-Medium', fontSize: 13 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TouchableOpacity
          onPress={decrement}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: Colors.sandDark,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: Colors.greyLighter,
          }}
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 20, color: Colors.charcoal, lineHeight: 24 }}>−</Text>
        </TouchableOpacity>

        <View style={{ minWidth: 40, alignItems: 'center' }}>
          {value === null ? (
            <Text style={{ color: Colors.greyLight, fontFamily: 'Nunito-Medium', fontSize: 16 }}>
              Any
            </Text>
          ) : (
            <Text style={{ color: Colors.charcoal, fontFamily: 'Nunito-Bold', fontSize: 18 }}>
              {value}
            </Text>
          )}
        </View>

        <TouchableOpacity
          onPress={increment}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: Colors.sky,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 20, color: Colors.white, lineHeight: 24 }}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Section header ───────────────────────────────────────────────────────────

const SectionTitle = memo(function SectionTitle({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontFamily: 'Nunito-Bold',
        fontSize: 15,
        color: Colors.charcoal,
        marginBottom: 10,
        marginTop: 20,
      }}
    >
      {title}
    </Text>
  );
});

// ─── Category chip wrapper ────────────────────────────────────────────────────

/**
 * Memoised wrapper so the onPress reference is stable per category ID.
 * Without this, the inline `() => toggleCategory(cat.id)` arrow in the map
 * creates a new function reference every render, causing every chip to re-render
 * even when only one category selection changed.
 */
interface CategoryChipProps {
  cat: Category;
  selected: boolean;
  onToggle: (id: string) => void;
}

const CategoryChip = memo(function CategoryChip({ cat, selected, onToggle }: CategoryChipProps) {
  const handlePress = useCallback(() => onToggle(cat.id), [cat.id, onToggle]);
  return (
    <Chip
      label={cat.name}
      icon={cat.icon}
      selected={selected}
      onPress={handlePress}
      accentColor={cat.color ?? Colors.sky}
    />
  );
});

// ─── Price chip wrapper ───────────────────────────────────────────────────────

/**
 * Same pattern as CategoryChip — stable onPress so Chip's memo is effective.
 * Without this wrapper, the inline `() => togglePrice(opt.value)` arrow in the
 * PRICE_OPTIONS.map creates a new reference every render, causing all price chips
 * to re-render when any draft state changes.
 */
interface PriceChipProps {
  opt: { value: PriceRange; label: string };
  selected: boolean;
  onToggle: (v: PriceRange) => void;
}

const PriceChip = memo(function PriceChip({ opt, selected, onToggle }: PriceChipProps) {
  const handlePress = useCallback(() => onToggle(opt.value), [opt.value, onToggle]);
  return <Chip label={opt.label} selected={selected} onPress={handlePress} />;
});

// ─── Facility chip wrapper ────────────────────────────────────────────────────

interface FacilityChipProps {
  fac: Facility;
  selected: boolean;
  onToggle: (id: string) => void;
}

const FacilityChip = memo(function FacilityChip({ fac, selected, onToggle }: FacilityChipProps) {
  const handlePress = useCallback(() => onToggle(fac.id), [fac.id, onToggle]);
  return <Chip label={fac.name} icon={fac.icon} selected={selected} onPress={handlePress} />;
});

// ─── FilterSheet (main component) ────────────────────────────────────────────

/**
 * FilterSheet
 *
 * A controlled modal sheet — the parent decides when it is visible:
 *
 *   const [filterSheetVisible, setFilterSheetVisible] = useState(false);
 *
 *   <FilterSheet
 *     visible={filterSheetVisible}
 *     onClose={() => setFilterSheetVisible(false)}
 *   />
 *
 *   <TouchableOpacity onPress={() => setFilterSheetVisible(true)}>
 *     <Text>Filters</Text>
 *   </TouchableOpacity>
 */
export default function FilterSheet({ visible, onClose }: FilterSheetProps) {
  // Read current filters and store actions from Zustand.
  const { filters: storedFilters, setFilters, resetFilters } = useFilterStore();

  // ── Responsive sheet height ────────────────────────────────────────────────
  // useWindowDimensions updates on orientation change; module-level
  // Dimensions.get() is frozen at app start and never updates.
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = screenHeight * 0.65;

  // ── Local draft state ──────────────────────────────────────────────────────
  // We keep a local copy so the user can change values without immediately
  // affecting the live map. We sync from the store when the sheet opens.
  const [draft, setDraft] = useState<VenueFilters>({ ...storedFilters });

  // ── Animation ──────────────────────────────────────────────────────────────
  // translateY starts at sheetHeight (below the screen) and springs to 0
  // when the sheet opens. animateClose springs it back and then calls onClose.
  const translateY = useRef(new Animated.Value(sheetHeight)).current;

  // Reset the starting position when screen height changes (e.g. orientation
  // flip) and the sheet is not visible, so the next open starts correctly.
  useEffect(() => {
    if (!visible) {
      translateY.setValue(sheetHeight);
    }
  }, [sheetHeight, visible, translateY]);

  useEffect(() => {
    if (visible) {
      // Sheet is opening — sync the draft with the current stored filters
      // so the user always sees the currently applied values on open.
      setDraft({ ...storedFilters });

      // Spring up into view.
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,   // slight bounce for a natural feel
        speed: 14,
      }).start();
    }
    // We intentionally exclude storedFilters from deps here — we only want to
    // sync the draft on open/close transitions, not on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, translateY]);

  // animateClose plays the spring-down first, then calls onClose so the parent
  // flips visible=false AFTER the animation settles. This fixes the Android
  // back-button instant-disappear bug (onRequestClose was firing before spring).
  const animateClose = useCallback(() => {
    Animated.spring(translateY, {
      toValue: sheetHeight,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start(() => onClose());
  }, [translateY, sheetHeight, onClose]);

  // ── Categories query ───────────────────────────────────────────────────────
  const {
    data: categories = [],
    isLoading: catsLoading,
    isError: catsError,
  } = useQuery<Category[], Error>({
    queryKey: ['categories'],
    // Categories rarely change — stale time of 10 minutes keeps network calls low.
    staleTime: 10 * 60 * 1000,
    // gcTime: React Query v5 default is 5 minutes. If the user does not open
    // the filter sheet for 5+ minutes the cache is discarded and they see a
    // spinner on next open. Categories almost never change — keep them in
    // memory for 1 hour so repeat filter sheet opens are always instant.
    gcTime: 60 * 60 * 1000,
    queryFn: fetchCategories,
  });

  // ── Facilities query ───────────────────────────────────────────────────────
  const {
    data: facilities = [],
    isLoading: facilitiesLoading,
  } = useQuery<Facility[], Error>({
    queryKey: ['facilities'],
    // Facilities rarely change — stale time of 10 minutes keeps network calls low.
    staleTime: 10 * 60 * 1000,
    // gcTime: same reasoning as categories above — keep for 1 hour so the
    // filter sheet always opens instantly without a spinner.
    gcTime: 60 * 60 * 1000,
    queryFn: fetchFacilities,
  });

  // ── Draft update helpers ───────────────────────────────────────────────────

  const toggleCategory = useCallback((id: string) => {
    setDraft((prev) => {
      const already = prev.categoryIds.includes(id);
      return {
        ...prev,
        categoryIds: already
          ? prev.categoryIds.filter((c) => c !== id)
          : [...prev.categoryIds, id],
      };
    });
  }, []);

  const togglePrice = useCallback((value: PriceRange) => {
    setDraft((prev) => {
      const already = prev.priceRange.includes(value);
      return {
        ...prev,
        priceRange: already
          ? prev.priceRange.filter((p) => p !== value)
          : [...prev.priceRange, value],
      };
    });
  }, []);

  const setMinAge = useCallback((v: number | null) => {
    setDraft((prev) => ({ ...prev, minAge: v }));
  }, []);

  const setMaxAge = useCallback((v: number | null) => {
    setDraft((prev) => {
      // If new max is below current min, pull min down to match so the range
      // never enters an impossible min > max state.
      const minAge = v !== null && prev.minAge !== null && prev.minAge > v ? v : prev.minAge;
      return { ...prev, maxAge: v, minAge };
    });
  }, []);

  const setDistance = useCallback((km: number) => {
    setDraft((prev) => ({ ...prev, maxDistanceKm: km }));
  }, []);

  const setOpenNow = useCallback((v: boolean) => {
    setDraft((prev) => ({ ...prev, openNow: v }));
  }, []);

  const toggleFacility = useCallback((id: string) => {
    setDraft((prev) => {
      const already = prev.facilityIds.includes(id);
      return {
        ...prev,
        facilityIds: already
          ? prev.facilityIds.filter((f) => f !== id)
          : [...prev.facilityIds, id],
      };
    });
  }, []);

  const setPremiumOnly = useCallback((v: boolean) => {
    setDraft((prev) => ({ ...prev, premiumOnly: v }));
  }, []);

  // ── Apply / Reset ──────────────────────────────────────────────────────────

  const handleApply = useCallback(() => {
    // Commit the draft to the global store so the map updates immediately.
    setFilters(draft);
    animateClose();
  }, [draft, setFilters, animateClose]);

  const handleReset = useCallback(() => {
    resetFilters();
    setDraft({ ...DEFAULT_FILTERS });
    animateClose();
  }, [resetFilters, animateClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    /*
     * Modal wraps everything. transparent={true} means the background of the
     * Modal's root view is see-through — we draw our own semi-opaque overlay
     * behind the sheet. animationType="none" because we drive the animation
     * ourselves with Animated.spring (this avoids a double-animation).
     */
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      onRequestClose={animateClose}   // Android back button: animate first, then close
      statusBarTranslucent={true} // sheet sits under the status bar on Android
    >
      {/* ── Overlay ──────────────────────────────────────────────────────────
          Pressable so tapping outside the sheet closes it.
          The overlay fills the entire screen behind the sheet.
      ─────────────────────────────────────────────────────────────────────── */}
      <Pressable
        onPress={animateClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end', // push the sheet to the bottom
        }}
        accessibilityLabel="Close filters"
        accessibilityRole="button"
      >
        {/* View claims the tap responder before the overlay Pressable, stopping
            close-on-tap, without interfering with ScrollView scroll gestures. */}
        <View onStartShouldSetResponder={() => true}>
          {/* ── Animated sheet panel ─────────────────────────────────────── */}
          <Animated.View
            style={{
              height: sheetHeight,
              backgroundColor: Colors.sand,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              overflow: 'hidden',
              // The spring animation translates the panel on the Y axis.
              transform: [{ translateY }],
            }}
          >
            {/* ── Drag handle ──────────────────────────────────────────────
                A small decorative pill at the top of the sheet. It signals
                to the user that the panel is draggable (visual affordance),
                even though we do not implement drag-to-dismiss here because
                that would require a gesture handler library.
            ──────────────────────────────────────────────────────────────── */}
            <View
              style={{
                alignItems: 'center',
                paddingTop: 12,
                paddingBottom: 4,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: Colors.greyLight,
                }}
              />
            </View>

            {/* ── Scrollable filter content ─────────────────────────────────
                paddingBottom: 120 creates room so the last filter section is
                not obscured by the absolutely-positioned Apply/Reset bar.
            ──────────────────────────────────────────────────────────────── */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <Text
                style={{
                  fontFamily: 'Nunito-ExtraBold',
                  fontSize: 20,
                  color: Colors.charcoal,
                  marginTop: 4,
                  marginBottom: 2,
                }}
              >
                Filter venues
              </Text>

              {/* ── 1. Categories ──────────────────────────────────────── */}
              <SectionTitle title="Category" />

              {catsLoading && (
                <ActivityIndicator size="small" color={Colors.sky} />
              )}

              {catsError && (
                <Text style={{ color: Colors.error, fontFamily: 'Nunito-Regular', fontSize: 13 }}>
                  Could not load categories. Try closing and reopening filters.
                </Text>
              )}

              {!catsLoading && !catsError && (
                // Horizontal chip row — a nested ScrollView is fine here because
                // one axis is horizontal and the outer ScrollView is vertical.
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8, paddingBottom: 4 }}
                >
                  {categories.map((cat) => (
                    <CategoryChip
                      key={cat.id}
                      cat={cat}
                      selected={draft.categoryIds.includes(cat.id)}
                      onToggle={toggleCategory}
                    />
                  ))}
                </ScrollView>
              )}

              {/* ── 2. Price ───────────────────────────────────────────── */}
              <SectionTitle title="Price" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {PRICE_OPTIONS.map((opt) => (
                  <PriceChip
                    key={opt.value}
                    opt={opt}
                    selected={draft.priceRange.includes(opt.value)}
                    onToggle={togglePrice}
                  />
                ))}
              </View>

              {/* ── 3. Age range ───────────────────────────────────────── */}
              <SectionTitle title="Age range" />
              <Text
                style={{
                  color: Colors.grey,
                  fontFamily: 'Nunito-Regular',
                  fontSize: 12,
                  marginBottom: 10,
                }}
              >
                Tap − below the minimum to clear
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                <AgeStepper
                  label="Min age"
                  value={draft.minAge}
                  min={MIN_AGE_LIMIT}
                  max={draft.maxAge ?? MAX_AGE_LIMIT}
                  onChange={setMinAge}
                />
                <AgeStepper
                  label="Max age"
                  value={draft.maxAge}
                  // Use the global floor (0), not draft.minAge, so pressing −
                  // can take maxAge below the current minAge. The setMaxAge
                  // handler then pulls minAge down to match — both values track
                  // together instead of maxAge clearing to null unexpectedly.
                  min={MIN_AGE_LIMIT}
                  max={MAX_AGE_LIMIT}
                  onChange={setMaxAge}
                />
              </View>

              {/* ── 4. Distance ────────────────────────────────────────── */}
              <SectionTitle title="Distance" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {DISTANCE_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.km}
                    label={`${opt.miles} mi`}
                    selected={draft.maxDistanceKm === opt.km}
                    onPress={() => setDistance(opt.km)}
                  />
                ))}
              </View>

              {/* ── 5. Open now ────────────────────────────────────────── */}
              <SectionTitle title="Availability" />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: Colors.sandDark,
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal }}>
                  Open now
                </Text>
                <Switch
                  value={draft.openNow}
                  onValueChange={setOpenNow}
                  // Use coral as the "on" track colour to match the app palette.
                  trackColor={{ false: Colors.greyLighter, true: Colors.skyLight }}
                  thumbColor={draft.openNow ? Colors.sky : Colors.white}
                  ios_backgroundColor={Colors.greyLighter}
                  accessibilityLabel="Show only venues open right now"
                  accessibilityRole="switch"
                />
              </View>

              {/* ── 6. Facilities ──────────────────────────────────────── */}
              <SectionTitle title="Facilities" />
              {facilitiesLoading && <ActivityIndicator size="small" color={Colors.sky} />}
              {!facilitiesLoading && facilities.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8, paddingBottom: 4 }}
                >
                  {facilities.map((fac) => (
                    <FacilityChip
                      key={fac.id}
                      fac={fac}
                      selected={draft.facilityIds.includes(fac.id)}
                      onToggle={toggleFacility}
                    />
                  ))}
                </ScrollView>
              )}

              {/* ── 7. Featured venues ─────────────────────────────────── */}
              <SectionTitle title="Featured venues" />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: Colors.sandDark,
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <View>
                  <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal }}>
                    Featured venues only
                  </Text>
                  <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: Colors.grey, marginTop: 2 }}>
                    Top-rated and verified by our team
                  </Text>
                </View>
                <Switch
                  value={draft.premiumOnly}
                  onValueChange={setPremiumOnly}
                  trackColor={{ false: Colors.greyLighter, true: Colors.skyLight }}
                  thumbColor={draft.premiumOnly ? Colors.sky : Colors.white}
                  ios_backgroundColor={Colors.greyLighter}
                  accessibilityLabel="Show only featured venues"
                  accessibilityRole="switch"
                />
              </View>
            </ScrollView>

            {/* ── Apply / Reset buttons ───────────────────────────────────────
                Positioned absolutely so they are always visible at the bottom
                of the sheet, even when the user has not scrolled down.
            ──────────────────────────────────────────────────────────────── */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                flexDirection: 'row',
                gap: 12,
                paddingHorizontal: 20,
                paddingVertical: 16,
                paddingBottom: 28, // extra room for home-bar devices
                backgroundColor: Colors.sand,
                borderTopWidth: 1,
                borderTopColor: Colors.greyLighter,
              }}
            >
              <TouchableOpacity
                onPress={handleReset}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 999,
                  alignItems: 'center',
                  backgroundColor: Colors.sandDark,
                  borderWidth: 1.5,
                  borderColor: Colors.greyLighter,
                }}
                accessibilityLabel="Reset all filters"
                accessibilityRole="button"
              >
                <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.grey }}>
                  Reset
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleApply}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: 999,
                  alignItems: 'center',
                  backgroundColor: Colors.sky,
                }}
                accessibilityLabel="Apply filters"
                accessibilityRole="button"
              >
                <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 15, color: Colors.white }}>
                  Apply filters
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Pressable>
    </Modal>
  );
}
