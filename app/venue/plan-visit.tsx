/**
 * Plan Visit screen
 *
 * Linked from the "Plan a visit" CTA on the venue detail screen.
 * Surfaces smart tips derived from real opening_hours data, one-tap
 * actions (directions, .ics calendar export, share, save), and an
 * interactive category-aware checklist.
 *
 * Add to Calendar: writes a .ics file to the cache dir and shares via
 * expo-sharing — no expo-calendar runtime permission required.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Share,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { useVenue } from '@/hooks/useVenues';
import { useUser } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import type { Venue } from '@/types';

// ─── Design tokens ────────────────────────────────────────────────────────────
const pp = {
  ink:      '#1D2630',
  inkSoft:  '#4A5560',
  mute:     '#7B8794',
  line:     '#E6E2DB',
  lineSoft: '#F1ECE2',
  sand:     '#FBF6EC',
  paper:    '#FFFFFF',
  sky:      '#2FB8B0',
  skyDeep:  '#1B8A85',
  skySoft:  '#D4F0EE',
  skyWash:  '#EEF9F8',
  star:     '#F5A524',
  starSoft: '#FFF1C7',
  coral:    '#FF6B6B',
  coralSoft:'#FFE8E8',
  leaf:     '#5BC08A',
  leafSoft: '#DCF4E4',
  purple:   '#8E6BD8',
  purpleSoft:'#ECE1FF',
};

// ─── Opening hours types ──────────────────────────────────────────────────────
interface HoursRow {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function padTwo(n: number) { return String(n).padStart(2, '0'); }

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}${ampm}` : `${hour}:${padTwo(m)}${ampm}`;
}

function isOpenNow(hours: HoursRow[]): boolean {
  if (!hours || hours.length === 0) return false;
  const now = new Date();
  const h = hours.find((r) => r.day_of_week === now.getDay());
  if (!h || h.is_closed || !h.opens_at || !h.closes_at) return false;
  const [oh, om] = h.opens_at.split(':').map(Number);
  const [ch, cm] = h.closes_at.split(':').map(Number);
  const cur   = now.getHours() * 60 + now.getMinutes();
  const open  = oh * 60 + om;
  const close = ch * 60 + cm;
  return close < open ? cur >= open || cur < close : cur >= open && cur < close;
}

function todayHoursRow(hours: HoursRow[]): HoursRow | undefined {
  return hours.find((r) => r.day_of_week === new Date().getDay());
}

/** Next occurrence of a given day-of-week (0=Sun), at least 1 day ahead. */
function nextDay(dow: number): Date {
  const now = new Date();
  const d = new Date(now);
  const diff = (dow - now.getDay() + 7) % 7 || 7;
  d.setDate(now.getDate() + diff);
  return d;
}

function toICSDate(date: Date): string {
  return (
    date.getFullYear() +
    padTwo(date.getMonth() + 1) +
    padTwo(date.getDate()) +
    'T' +
    padTwo(date.getHours()) +
    padTwo(date.getMinutes()) +
    padTwo(date.getSeconds())
  );
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

// RFC 5545 §3.1 — content lines > 75 octets must be folded with CRLF + SPACE.
function foldICSLine(line: string): string {
  if (line.length <= 75) return line;
  let out = '';
  let rest = line;
  while (rest.length > 75) {
    out  += rest.slice(0, 75) + '\r\n ';
    rest  = rest.slice(75);
  }
  return out + rest;
}

function buildICS(venue: Venue): string {
  const hours = venue.opening_hours ?? [];

  // Find next day the venue is open; fall back to Saturday 10:00
  let visitDate: Date | null = null;
  let openHour = 10;
  let openMin  = 0;

  for (let i = 1; i <= 7; i++) {
    const candidate = new Date();
    candidate.setDate(candidate.getDate() + i);
    const row = hours.find((r) => r.day_of_week === candidate.getDay());
    if (!row || row.is_closed || !row.opens_at) continue;
    visitDate = candidate;
    [openHour, openMin] = row.opens_at.split(':').map(Number);
    break;
  }

  if (!visitDate) {
    // No opening hours — default to next Saturday at 10:00
    visitDate = nextDay(6);
  }

  visitDate.setHours(openHour, openMin, 0, 0);
  const endDate = new Date(visitDate.getTime() + 2 * 60 * 60 * 1000); // +2h

  const address = [venue.address_line1, venue.address_line2, venue.city, venue.postcode]
    .filter(Boolean)
    .join(', ');

  const uid      = `playplanner-${venue.id}-${Date.now()}@playplanner.co.uk`;
  const dtstamp  = toICSDate(new Date());
  const dtstart  = toICSDate(visitDate);
  const dtend    = toICSDate(endDate);
  const summary  = escapeICS(`Visit to ${venue.name}`);
  const location = escapeICS(address);
  const desc     = escapeICS(`Plan your family visit to ${venue.name}. Planned via PlayPlanner.`);

  // Each line folded to ≤75 octets per RFC 5545 §3.1.
  // Trailing \r\n after join satisfies the requirement that every line,
  // including END:VCALENDAR, is CRLF-terminated.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PlayPlanner//PlayPlanner//EN',
    'BEGIN:VEVENT',
    foldICSLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    foldICSLine(`SUMMARY:${summary}`),
    foldICSLine(`LOCATION:${location}`),
    foldICSLine(`DESCRIPTION:${desc}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

// ─── Smart tips ───────────────────────────────────────────────────────────────
interface Tip {
  id:    string;
  icon:  IconName;
  color: string;
  bg:    string;
  title: string;
  body:  string;
}

function buildTips(venue: Venue): Tip[] {
  const hours = (venue.opening_hours ?? []) as HoursRow[];
  const now   = new Date();
  const dow   = now.getDay();
  const row   = todayHoursRow(hours);
  const tips: Tip[] = [];

  // Tip 1 — derived from today's opening hours.
  // If the venue is currently open, say "Open until X" so parents know how long
  // they have. If not yet open, say "Opens at X" so they know when to arrive.
  const currentlyOpen = isOpenNow(hours);
  if (row && !row.is_closed && currentlyOpen && row.closes_at) {
    tips.push({
      id:    'arrival',
      icon:  'clock',
      color: pp.sky,
      bg:    pp.skyWash,
      title: `Open until ${formatTime(row.closes_at)}`,
      body:  'You have time to enjoy a full visit today.',
    });
  } else if (row && !row.is_closed && !currentlyOpen && row.opens_at) {
    tips.push({
      id:    'arrival',
      icon:  'clock',
      color: pp.sky,
      bg:    pp.skyWash,
      title: `Opens at ${formatTime(row.opens_at)}`,
      body:  'Arriving close to opening gives you the best pick of spaces and avoids midday crowds.',
    });
  } else {
    tips.push({
      id:    'arrival',
      icon:  'clock',
      color: pp.sky,
      bg:    pp.skyWash,
      title: 'Check opening times',
      body:  'Hours may vary on bank holidays — worth checking the venue website before you head out.',
    });
  }

  // Tip 2 — weekday vs weekend
  const isWeekend = dow === 0 || dow === 6;
  tips.push({
    id:    'busy',
    icon:  'leaf',
    color: pp.leaf,
    bg:    pp.leafSoft,
    title: isWeekend ? 'Weekend visit' : 'Quieter today',
    body:  isWeekend
      ? 'Weekends are popular — aim to arrive early or after 2pm for a calmer experience.'
      : 'Weekday mornings are usually quieter, perfect for toddlers and younger children.',
  });

  // Tip 3 — category-specific practical note
  const slug     = venue.category?.slug ?? '';
  const outdoor  = ['park', 'farm', 'outdoor-sports'].includes(slug);
  const water    = ['swimming'].includes(slug);
  const creative = ['arts', 'library'].includes(slug);

  if (outdoor) {
    tips.push({
      id:    'practical',
      icon:  'shield',
      color: pp.star,
      bg:    pp.starSoft,
      title: 'Pack for the weather',
      body:  'British weather can change fast — a light waterproof and layers are always worth bringing.',
    });
  } else if (water) {
    tips.push({
      id:    'practical',
      icon:  'shield',
      color: pp.star,
      bg:    pp.starSoft,
      title: 'Check the session',
      body:  'Many pools run timed sessions. Book ahead to guarantee your slot, especially at weekends.',
    });
  } else if (creative) {
    tips.push({
      id:    'practical',
      icon:  'sparkle',
      color: pp.purple,
      bg:    pp.purpleSoft,
      title: 'Free or low cost',
      body:  'Many libraries and arts centres offer free or low-cost family activities. Check for upcoming events.',
    });
  } else {
    tips.push({
      id:    'practical',
      icon:  'shield',
      color: pp.star,
      bg:    pp.starSoft,
      title: 'Good to know',
      body:  'Some venues require pre-booking at busy times. Check the website or call ahead to be sure.',
    });
  }

  return tips;
}

// ─── Checklist ────────────────────────────────────────────────────────────────
export function getChecklistItems(slug?: string | null): string[] {
  switch (slug) {
    case 'soft-play':
    case 'indoor-play':
    case 'trampoline':
      return ['Grip socks', 'Change of clothes', 'Snacks & drinks', 'Nappies / wipes', 'Cash or card'];
    case 'park':
    case 'outdoor-sports':
      return ['Sunscreen', 'Snacks & water', 'Wellies or waterproofs', 'Picnic blanket', 'Change of clothes'];
    case 'farm':
      return ['Wellies', 'Hand sanitiser', 'Snacks & drinks', 'Sun hat or rain jacket', 'Change of clothes'];
    case 'swimming':
      return ['Swimwear & towel', 'Swim nappies (if needed)', 'Goggles', 'Snacks & water', 'Change of clothes'];
    case 'arts':
    case 'library':
      return ['Packed lunch or snacks', 'Comfortable shoes', 'Notepad & crayons', 'Water bottle'];
    case 'bowling':
    case 'sports':
      return ['Comfortable shoes', 'Snacks & water', 'Cash or card', 'Change of clothes'];
    case 'cafe':
      return ['Nappies / wipes', 'Toys or activity book', 'High chair if very young', 'Cash or card'];
    default:
      return ['Snacks & water', 'Nappies / wipes', 'Change of clothes', 'Camera', 'Cash or card'];
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TipCard({ tip }: { tip: Tip }) {
  return (
    <View style={styles.tipCard}>
      <View style={[styles.tipIconCircle, { backgroundColor: tip.bg }]}>
        <Icon name={tip.icon} size={18} color={tip.color} />
      </View>
      <View style={styles.tipTextCol}>
        <Text style={styles.tipTitle}>{tip.title}</Text>
        <Text style={styles.tipBody}>{tip.body}</Text>
      </View>
    </View>
  );
}

function ActionTile({
  icon,
  label,
  iconColor,
  iconBg,
  onPress,
  loading,
  active,
}: {
  icon:      IconName;
  label:     string;
  iconColor: string;
  iconBg:    string;
  onPress:   () => void;
  loading?:  boolean;
  active?:   boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.actionTile}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.actionIconCircle, { backgroundColor: active ? iconColor : iconBg }]}>
        {loading ? (
          <ActivityIndicator size="small" color={active ? pp.paper : iconColor} />
        ) : (
          <Icon name={icon} size={22} color={active ? pp.paper : iconColor} />
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function CheckItem({
  label,
  checked,
  onToggle,
}: {
  label:    string;
  checked:  boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkItem}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <Icon name="check" size={13} color={pp.paper} strokeWidth={2.5} />}
      </View>
      <Text style={[styles.checkLabel, checked && styles.checkLabelDone]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Loading / Error screens ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={pp.sky} />
      </View>
    </SafeAreaView>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.centred}>
        <Icon name="info" size={44} color={pp.mute} />
        <Text style={styles.errorTitle}>{message}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="chevL" size={16} color={pp.sky} />
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PlanVisitScreen() {
  const { venueId: rawId, distance_km: rawDistanceKm } = useLocalSearchParams<{ venueId: string; distance_km?: string }>();
  const venueId = Array.isArray(rawId) ? rawId[0] : rawId ?? '';

  const user         = useUser();
  const queryClient  = useQueryClient();

  const { data: venue, isLoading, error } = useVenue(venueId);

  // ── Favourite state ────────────────────────────────────────────────────────
  const { data: isFavourited } = useQuery({
    queryKey: ['favourite', user?.id, venueId],
    queryFn: async () => {
      if (!user?.id || !venueId) return false;
      const { data } = await supabase
        .from('favourites')
        .select('id')
        .eq('user_id', user.id)
        .eq('venue_id', venueId)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!venueId,
  });

  const toggleFavourite = useMutation({
    mutationFn: async () => {
      if (!user?.id || !venueId) throw new Error('Sign in to save venues.');
      const cached: boolean | undefined = queryClient.getQueryData(['favourite', user.id, venueId]);
      const faved = cached ?? false;
      if (faved) {
        await supabase.from('favourites').delete().eq('user_id', user.id).eq('venue_id', venueId);
      } else {
        await supabase.from('favourites').insert({ user_id: user.id, venue_id: venueId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourite', user?.id, venueId] });
      queryClient.invalidateQueries({ queryKey: ['favourites', user?.id] });
    },
    onError: (err) => {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update favourites.');
    },
  });

  // ── Checklist state ────────────────────────────────────────────────────────
  const checklistItems = useMemo(
    () => getChecklistItems(venue?.category?.slug),
    // venue?.category?.slug is available when slug is in the select — falls back gracefully
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venue?.id]
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const toggleCheck = useCallback(
    (label: string) => setChecked((prev) => ({ ...prev, [label]: !prev[label] })),
    []
  );
  const checkedCount = Object.values(checked).filter(Boolean).length;

  // ── Derived display values ─────────────────────────────────────────────────
  const tips     = useMemo(() => (venue ? buildTips(venue) : []), [venue]);
  const hours    = (venue?.opening_hours ?? []) as HoursRow[];
  const openNow  = isOpenNow(hours);
  const todayRow = todayHoursRow(hours);

  // Mirror the cover-photo resolution from venue/[id].tsx — prefer is_cover,
  // fall back to first approved photo. photos[] is pre-filtered to approved only.
  const coverPhoto = venue?.photos?.find((p) => p.is_cover && p.url)
    ?? venue?.photos?.find((p) => !!p.url)
    ?? null;
  const hasPhoto = !!coverPhoto?.url;

  const address = venue
    ? [venue.address_line1, venue.address_line2, venue.city, venue.postcode]
        .filter(Boolean)
        .join(', ')
    : '';

  const distanceMiles = (() => {
    const raw = rawDistanceKm ? parseFloat(rawDistanceKm) : null;
    return raw != null && Number.isFinite(raw) && raw > 0
      ? `${(raw * 0.621371).toFixed(1)} mi`
      : null;
  })();

  // ── Action handlers ────────────────────────────────────────────────────────
  const handleDirections = useCallback(async () => {
    if (!venue?.latitude || !venue?.longitude) {
      Alert.alert('No location', 'This venue does not have location data available.');
      return;
    }
    const { latitude: lat, longitude: lng } = venue;
    const url = Platform.select({
      ios:     `maps:0,0?q=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    })!;
    const fallback = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    try {
      await (await Linking.canOpenURL(url) ? Linking.openURL(url) : Linking.openURL(fallback));
    } catch {
      Alert.alert('Cannot open maps', 'Could not open a maps app on your device.');
    }
  }, [venue]);

  const handleAddToCalendar = useCallback(async () => {
    if (!venue) return;
    try {
      const ics     = buildICS(venue);
      const fileUri = `${FileSystem.cacheDirectory}playplanner-visit.ics`;
      await FileSystem.writeAsStringAsync(fileUri, ics, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Not available', 'Calendar sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType:    'text/calendar',
        dialogTitle: 'Add to Calendar',
        UTI:         'com.apple.ical.ics',
      });
    } catch {
      Alert.alert('Error', 'Could not create the calendar event. Please try again.');
    }
  }, [venue]);

  const handleShare = useCallback(async () => {
    if (!venue) return;
    const openStatus = todayRow && !todayRow.is_closed && todayRow.opens_at && todayRow.closes_at
      ? `Open ${formatTime(todayRow.opens_at)} – ${formatTime(todayRow.closes_at)}`
      : 'Check opening times before you go';

    try {
      await Share.share({
        message: Platform.OS === 'ios'
          ? `I'm planning a visit to ${venue.name}!\n\n${openStatus}\n${address}`
          : `I'm planning a visit to ${venue.name}!\n\n${openStatus}\n${address}\n\nFound on PlayPlanner`,
        title: `Visit to ${venue.name}`,
      });
    } catch {
      // dismissed
    }
  }, [venue, address, todayRow]);

  const handleSave = useCallback(() => {
    if (!user) {
      Alert.alert('Sign in to save', 'Create a free account to save your favourite venues.', [
        { text: 'Sign in', onPress: () => router.push('/(auth)/login') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    toggleFavourite.mutate();
  }, [user, toggleFavourite]);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (isLoading) return <LoadingScreen />;
  if (error || !venue) return <ErrorScreen message="Venue not found." />;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >

        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBack}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="chevL" size={20} color={pp.ink} />
          </TouchableOpacity>

          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>Plan your visit</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{venue.name}</Text>
          </View>

          {/* Right spacer matches back button width for centre alignment */}
          <View style={styles.headerSpacer} />
        </View>

        {/* ── Venue summary card ──────────────────────────────────────── */}
        <View style={styles.venueCard}>
          {/* Thumbnail */}
          <View style={styles.venueThumbnail}>
            {hasPhoto ? (
              <Image
                source={{ uri: coverPhoto!.url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <CategoryPlaceholder
                categorySlug={venue.category?.slug}
                size={60}
                borderRadius={14}
              />
            )}
          </View>

          {/* Info */}
          <View style={styles.venueInfo}>
            <Text style={styles.venueName} numberOfLines={2}>{venue.name}</Text>
            {!!address && (
              <Text style={styles.venueAddress} numberOfLines={2}>{address}</Text>
            )}
            <View style={styles.venueBadgeRow}>
              {distanceMiles && (
                <View style={styles.distancePill}>
                  <Icon name="walk" size={10} color={pp.mute} />
                  <Text style={styles.distancePillText}>{distanceMiles}</Text>
                </View>
              )}
              <View style={[styles.openBadge, { backgroundColor: openNow ? pp.leafSoft : pp.lineSoft }]}>
                <View style={[styles.openDot, { backgroundColor: openNow ? pp.leaf : pp.mute }]} />
                <Text style={[styles.openBadgeText, { color: openNow ? '#2D7A4F' : pp.mute }]}>
                  {openNow
                    ? todayRow?.closes_at ? `Closes ${formatTime(todayRow.closes_at)}` : 'Open now'
                    : todayRow && !todayRow.is_closed && todayRow.opens_at
                      ? `Opens ${formatTime(todayRow.opens_at)}`
                      : 'Closed today'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Smart tips ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <Icon name="sparkle" size={16} color={pp.sky} />
            <Text style={styles.sectionHeading}>Smart tips</Text>
          </View>
          <View style={styles.tipsStack}>
            {tips.map((tip, i) => (
              <View key={tip.id}>
                <TipCard tip={tip} />
                {i < tips.length - 1 && <View style={styles.tipDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* ── Quick actions ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Quick actions</Text>
          <View style={styles.actionsGrid}>
            <View style={styles.actionsRow}>
              <ActionTile
                icon="pin"
                label="Directions"
                iconColor={pp.sky}
                iconBg={pp.skyWash}
                onPress={handleDirections}
              />
              <ActionTile
                icon="calendar"
                label="Add to Calendar"
                iconColor={pp.star}
                iconBg={pp.starSoft}
                onPress={handleAddToCalendar}
              />
            </View>
            <View style={styles.actionsRow}>
              <ActionTile
                icon="share"
                label="Share Plan"
                iconColor={pp.purple}
                iconBg={pp.purpleSoft}
                onPress={handleShare}
              />
              <ActionTile
                icon={isFavourited ? 'heartFill' : 'heart'}
                label={isFavourited ? 'Saved' : 'Save for Later'}
                iconColor={pp.coral}
                iconBg={pp.coralSoft}
                active={!!isFavourited}
                loading={toggleFavourite.isPending}
                onPress={handleSave}
              />
            </View>
          </View>
        </View>

        {/* ── What to bring checklist ─────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionHeading}>What to bring</Text>
            {checkedCount > 0 && (
              <View style={styles.packedBadge}>
                <Text style={styles.packedBadgeText}>
                  {checkedCount}/{checklistItems.length} packed
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.checklistSub}>Tap to tick off as you pack</Text>

          <View style={styles.checklistCard}>
            {checklistItems.map((label, i) => (
              <View key={label}>
                <CheckItem
                  label={label}
                  checked={!!checked[label]}
                  onToggle={() => toggleCheck(label)}
                />
                {i < checklistItems.length - 1 && <View style={styles.checkDivider} />}
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: pp.sand,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorTitle: {
    fontFamily: 'Nunito-Bold',
    fontSize: 16,
    color: pp.ink,
    textAlign: 'center',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  backBtnText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 14,
    color: pp.sky,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: pp.paper,
    borderWidth: 1,
    borderColor: pp.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 20,
    color: pp.ink,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: pp.mute,
    marginTop: 1,
  },
  headerSpacer: {
    width: 40,
  },

  // ── Venue summary card ──
  venueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    backgroundColor: pp.paper,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: pp.line,
    padding: 14,
    shadowColor: pp.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
    gap: 14,
  },
  venueThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: pp.lineSoft,
    flexShrink: 0,
  },
  venueInfo: {
    flex: 1,
    gap: 4,
  },
  venueName: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: pp.ink,
    lineHeight: 21,
  },
  venueAddress: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: pp.mute,
    lineHeight: 17,
  },
  venueBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  distancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: pp.sand,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: pp.line,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  distancePillText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: pp.mute,
  },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  openDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  openBadgeText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
  },

  // ── Sections ──
  section: {
    paddingHorizontal: 20,
    marginTop: 28,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionHeading: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 18,
    color: pp.ink,
    letterSpacing: -0.3,
  },

  // ── Tips ──
  tipsStack: {
    backgroundColor: pp.paper,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: pp.line,
    overflow: 'hidden',
    shadowColor: pp.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    gap: 14,
  },
  tipIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tipTextCol: {
    flex: 1,
  },
  tipTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: pp.ink,
    marginBottom: 3,
  },
  tipBody: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: pp.inkSoft,
    lineHeight: 19,
  },
  tipDivider: {
    height: 1,
    backgroundColor: pp.line,
    marginHorizontal: 16,
  },

  // ── Actions ──
  actionsGrid: {
    gap: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionTile: {
    flex: 1,
    backgroundColor: pp.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: pp.line,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
    shadowColor: pp.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  actionIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
    color: pp.ink,
    textAlign: 'center',
  },

  // ── Checklist ──
  checklistSub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: pp.mute,
    marginTop: -8,
    marginBottom: 14,
  },
  packedBadge: {
    backgroundColor: pp.skyWash,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: pp.skySoft,
  },
  packedBadgeText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 11,
    color: pp.skyDeep,
  },
  checklistCard: {
    backgroundColor: pp.paper,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: pp.line,
    overflow: 'hidden',
    shadowColor: pp.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: pp.sky,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: pp.sky,
    borderColor: pp.sky,
  },
  checkLabel: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 15,
    color: pp.ink,
    flex: 1,
  },
  checkLabelDone: {
    color: pp.mute,
    textDecorationLine: 'line-through',
  },
  checkDivider: {
    height: 1,
    backgroundColor: pp.lineSoft,
    marginHorizontal: 16,
  },
});
