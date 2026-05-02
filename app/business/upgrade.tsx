/**
 * Business upgrade screen — PlayPlanner Pass subscription
 *
 * UI: annual plan visually emphasised as "Best value".
 * Logic: useSubscribe hook handles Stripe Checkout Session creation,
 *        browser open, and profile refresh on close.
 *
 * PRIVACY: no payment details are rendered or logged here.
 * The actual Stripe secret lives only in the Edge Function.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PREMIUM_PRICE_ANNUAL_DISPLAY,
  PREMIUM_PRICE_ANNUAL_MONTHLY_EQUIV,
  PREMIUM_PRICE_MONTHLY_DISPLAY,
} from '@/constants/pricing';
import { useSubscribe } from '@/hooks/useSubscribe';
import { fetchPlanPriceIds, type PlanPriceIds } from '@/lib/stripe';

// ─── Feature list ────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: '★', label: 'Featured placement in search results' },
  { icon: '⬆', label: 'Priority listing above free venues' },
  { icon: '⬜', label: 'Unlimited photo uploads' },
  { icon: '▤', label: 'Detailed visitor analytics' },
  { icon: '✓', label: 'Verified badge on your listing' },
  { icon: '◎', label: 'Direct message from interested families' },
] as const;

// ─── Plan type ───────────────────────────────────────────────────────────────

type PlanTier = 'annual' | 'monthly';

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PlanCardProps {
  tier: PlanTier;
  selected: boolean;
  onSelect: () => void;
}

function PlanCard({ tier, selected, onSelect }: PlanCardProps) {
  const isAnnual = tier === 'annual';

  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={
        isAnnual
          ? `Annual plan, ${PREMIUM_PRICE_ANNUAL_DISPLAY}, best value`
          : `Monthly plan, ${PREMIUM_PRICE_MONTHLY_DISPLAY}`
      }
      className={[
        'rounded-2xl p-5 mb-3',
        selected
          ? 'bg-sky border-2 border-sky'
          : 'bg-white border-2 border-greyLighter',
      ].join(' ')}
    >
      {/* Top row: plan name + badge */}
      <View className="flex-row items-center justify-between mb-1">
        <Text
          className={[
            'text-base font-bold',
            selected ? 'text-white' : 'text-charcoal',
          ].join(' ')}
        >
          {isAnnual ? 'Annual' : 'Monthly'}
        </Text>

        {isAnnual && (
          <View
            className={[
              'px-2 py-0.5 rounded-full',
              selected ? 'bg-white/25' : 'bg-sky/15',
            ].join(' ')}
          >
            <Text
              className={[
                'text-xs font-bold',
                selected ? 'text-white' : 'text-sky',
              ].join(' ')}
            >
              Best value
            </Text>
          </View>
        )}
      </View>

      {/* Price */}
      <Text
        className={[
          'text-2xl font-extrabold mt-0.5',
          selected ? 'text-white' : 'text-charcoal',
        ].join(' ')}
      >
        {isAnnual ? PREMIUM_PRICE_ANNUAL_DISPLAY : PREMIUM_PRICE_MONTHLY_DISPLAY}
      </Text>

      {/* Sub-label */}
      {isAnnual && (
        <Text
          className={[
            'text-xs mt-1',
            selected ? 'text-white/80' : 'text-grey',
          ].join(' ')}
        >
          That is just {PREMIUM_PRICE_ANNUAL_MONTHLY_EQUIV} — save 44% vs monthly
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function UpgradeScreen() {
  const [selectedTier, setSelectedTier] = useState<PlanTier>('annual');
  const { mutate: subscribe, isPending } = useSubscribe();

  // ── Load plan price IDs from the edge function ────────────────────────────
  // Price IDs are not embedded in the app bundle. They are fetched once on
  // mount so they are available for any future client-side use (e.g. showing
  // the correct price in a payment sheet). The checkout itself also resolves
  // them server-side, so a loading failure does not block the subscribe CTA.
  const [planIds, setPlanIds]           = useState<PlanPriceIds | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError]     = useState(false);

  async function loadPlanIds() {
    setPlansLoading(true);
    setPlansError(false);
    try {
      const ids = await fetchPlanPriceIds();
      setPlanIds(ids);
    } catch {
      setPlansError(true);
    } finally {
      setPlansLoading(false);
    }
  }

  useEffect(() => {
    void loadPlanIds();
  }, []);

  // ── Render: loading splash ────────────────────────────────────────────────
  if (plansLoading) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center" edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color="#0EA5E9" />
        <Text className="text-grey text-sm mt-3">Loading plans…</Text>
      </SafeAreaView>
    );
  }

  // ── Render: error splash with retry ──────────────────────────────────────
  if (plansError || !planIds) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center px-6" edges={['top', 'bottom']}>
        <Text className="text-charcoal text-base font-bold text-center mb-2">
          Could not load plans
        </Text>
        <Text className="text-grey text-sm text-center mb-6">
          Please check your connection and try again.
        </Text>
        <TouchableOpacity
          onPress={() => void loadPlanIds()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading plans"
          className="bg-sky rounded-2xl px-8 py-3"
        >
          <Text className="text-white font-bold text-base">Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="mt-4"
        >
          <Text className="text-grey text-sm">← Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  function handleSubscribe() {
    subscribe(
      { tier: selectedTier },
      {
        onError: () => {
          Alert.alert(
            'Something went wrong',
            'We could not start your subscription. Please check your connection and try again.',
            [{ text: 'OK' }],
          );
        },
      },
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate" edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Back button ───────────────────────────────────────────── */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-4 mb-8 self-start flex-row items-center gap-1"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text className="text-grey text-sm">← Back</Text>
        </TouchableOpacity>

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <View className="mb-8">
          <Text className="text-xs font-bold text-sky tracking-widest uppercase mb-2">
            PlayPlanner Pass
          </Text>
          <Text className="text-3xl font-extrabold text-charcoal leading-tight">
            Grow your{'\n'}venue listing
          </Text>
          <Text className="text-grey text-base mt-3 leading-relaxed">
            Stand out to thousands of families searching for activities near them.
          </Text>
        </View>

        {/* ── Feature list ──────────────────────────────────────────── */}
        <View className="bg-white rounded-2xl px-5 py-4 mb-8">
          {FEATURES.map((f, i) => (
            <View
              key={f.label}
              className={[
                'flex-row items-center gap-3',
                i < FEATURES.length - 1 ? 'mb-3' : '',
              ].join(' ')}
            >
              <View className="w-7 h-7 rounded-full bg-sky/15 items-center justify-center">
                <Text className="text-sky text-xs font-bold">{f.icon}</Text>
              </View>
              <Text className="text-charcoal text-sm font-medium flex-1">{f.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Plan selector ─────────────────────────────────────────── */}
        <Text className="text-xs font-bold text-charcoal/50 tracking-widest uppercase mb-3">
          Choose your plan
        </Text>

        <PlanCard
          tier="annual"
          selected={selectedTier === 'annual'}
          onSelect={() => setSelectedTier('annual')}
        />
        <PlanCard
          tier="monthly"
          selected={selectedTier === 'monthly'}
          onSelect={() => setSelectedTier('monthly')}
        />

        {/* ── CTA ───────────────────────────────────────────────────── */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={isPending}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={
            isPending
              ? 'Processing, please wait'
              : `Subscribe to ${selectedTier} plan`
          }
          className={[
            'w-full rounded-2xl py-4 items-center justify-center mt-6',
            isPending ? 'bg-sky/60' : 'bg-sky',
          ].join(' ')}
        >
          {isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-bold text-base">
              {selectedTier === 'annual'
                ? `Subscribe — ${PREMIUM_PRICE_ANNUAL_DISPLAY}`
                : `Subscribe — ${PREMIUM_PRICE_MONTHLY_DISPLAY}`}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── Trust line ────────────────────────────────────────────── */}
        <Text className="text-grey/70 text-xs text-center mt-4 leading-relaxed">
          Secure payment via Stripe. Cancel anytime.{'\n'}
          You will be redirected to complete payment in your browser.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
