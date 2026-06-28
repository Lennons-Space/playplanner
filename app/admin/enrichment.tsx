/**
 * Admin — Website Enrichment Review screen.
 *
 * Shows pending AND approved-but-unapplied field proposals extracted from venue
 * websites, grouped by venue. Admins can Approve & Apply (write to DB) or Reject
 * (with notes) each proposal. Approved-but-unapplied rows show Retry Apply and
 * Return to Pending.
 *
 * SECURITY:
 * - Authenticated supabase client only — never service-role.
 * - Same auth guard pattern as moderation.tsx: wait for profile load, then
 *   useIsAdmin(); non-admins get <Redirect> immediately.
 * - No auto-approval. Every action is explicit.
 * - Errors from RPCs are surfaced verbatim; proposals are never removed
 *   optimistically (only removed after a successful invalidation + refetch).
 * - Client NEVER calls propose_field or snapshot_current_value.
 *
 * FIELD-TYPE RULES:
 * - Scalars (phone/email/website/price_range): Approve & Apply + Reject.
 * - description: admin must enter ORIGINAL rewritten text; Apply disabled until
 *   non-empty; proposed/evidence shown as reference only.
 * - opening_hours: 7-day schedule rendered; explicit Alert confirmation required.
 * - booking_url: NO Apply button (no target column); only Leave Pending or Reject.
 *
 * APPROVED-BUT-UNAPPLIED (status='approved'):
 * - Step 1 (UPDATE) succeeded but step 2 (RPC apply) failed previously.
 * - Show "Retry Apply" (step 2 only) and "Return to Pending".
 */

import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsAdmin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import {
  useReviewableProposals,
  useResolveProposal,
} from '@/hooks/useEnrichmentProposals';
import type { ProposalRow } from '@/hooks/useEnrichmentProposals';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type VenueGroup = {
  venueId: string;
  venueName: string;
  proposals: ProposalRow[];
};

type OpeningDayDisplay = {
  day_of_week: number;
  is_closed: boolean;
  intervals: { opens: string; closes: string }[];
};

type OpeningWeekDisplay = {
  days: OpeningDayDisplay[];
  seasonal_notes: string | null;
  source_text?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the scalar display value from a `{ v: string }` JSONB wrapper. */
function scalarValue(v: unknown): string {
  if (!v || typeof v !== 'object') return '—';
  const obj = v as Record<string, unknown>;
  return typeof obj['v'] === 'string' ? obj['v'] : '—';
}

/** Human-readable field label. */
function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    phone:         'Phone',
    email:         'Email',
    website:       'Website',
    price_range:   'Price Range',
    booking_url:   'Booking URL',
    description:   'Description',
    opening_hours: 'Opening Hours',
  };
  return labels[field] ?? field;
}

/**
 * Map known RPC error codes to friendly messages. Unknown codes are surfaced
 * verbatim so the admin has full context.
 */
function enrichmentErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('stale_current_value'))
    return 'The venue data changed since this proposal was created — refresh and try again.';
  if (msg.startsWith('not_admin'))
    return 'Admin permission required. Sign out and back in, then retry.';
  if (msg.startsWith('not_approved'))
    return 'Internal error: proposal was not in approved state.';
  if (msg.startsWith('description_text_required'))
    return 'You must enter a rewritten description before applying.';
  if (msg.startsWith('description_not_rewritten'))
    return 'The text you entered matches the extracted text. Write an ORIGINAL summary.';
  if (msg.startsWith('no_target_column'))
    return 'booking_url has no target column yet. Use Reject instead of Apply.';
  if (msg.startsWith('not_found'))
    return 'Proposal not found — it may have been resolved already.';
  if (msg.startsWith('invalid_email'))
    return 'The proposed email address format is not valid.';
  if (msg.startsWith('invalid_enum_value'))
    return 'The proposed price range value is not valid.';
  if (msg.startsWith('incomplete_week'))
    return 'Opening hours must include all 7 days before applying.';
  if (msg.startsWith('duplicate_day_of_week'))
    return 'Opening hours contain a duplicate day entry.';
  // Surface exact string for any unknown errors
  return msg || 'Unknown error. Please try again.';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EnrichmentScreen() {
  const isAdmin       = useIsAdmin();
  const user          = useAuthStore((s) => s.user);
  const profile       = useAuthStore((s) => s.profile);
  const authIsLoading = useAuthStore((s) => s.isLoading);

  // ── Data ─────────────────────────────────────────────────────────────────
  const {
    data: proposals = [],
    isLoading: proposalsLoading,
    error: proposalsError,
  } = useReviewableProposals(isAdmin);

  const { approveAndApply, retryApply, returnToPending, reject } = useResolveProposal();

  // ── Local UI state ────────────────────────────────────────────────────────

  // Rejection modal
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectProposalId,   setRejectProposalId]   = useState<string | null>(null);
  const [rejectNote,         setRejectNote]         = useState('');

  // Description rewrite text — per proposal ID.
  // Admin must type ORIGINAL text here; the input is NOT prefilled with evidence.
  const [descriptionTexts, setDescriptionTexts] = useState<Record<string, string>>({});

  // Per-proposal inline error messages — set on mutation error, cleared on retry.
  // On error the proposal is NOT removed from the list.
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>({});

  // Which proposal is in-flight (for per-button loading state)
  const [pendingApproveId,     setPendingApproveId]     = useState<string | null>(null);
  const [pendingRetryId,       setPendingRetryId]       = useState<string | null>(null);
  const [pendingReturnId,      setPendingReturnId]      = useState<string | null>(null);
  const [pendingRejectId,      setPendingRejectId]      = useState<string | null>(null);

  // ── Group proposals by venue ──────────────────────────────────────────────
  const groupedProposals = useMemo((): VenueGroup[] => {
    const groups: Record<string, VenueGroup> = {};
    for (const p of proposals) {
      if (!groups[p.venue_id]) {
        groups[p.venue_id] = {
          venueId:   p.venue_id,
          venueName: p.venues?.name ?? 'Unknown venue',
          proposals: [],
        };
      }
      groups[p.venue_id].proposals.push(p);
    }
    return Object.values(groups);
  }, [proposals]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const clearError = (id: string) =>
    setProposalErrors((prev) => ({ ...prev, [id]: '' }));

  const setError = (id: string, err: unknown) =>
    setProposalErrors((prev) => ({ ...prev, [id]: enrichmentErrorMessage(err) }));

  const handleApproveApply = (proposal: ProposalRow, appliedText?: string) => {
    setPendingApproveId(proposal.id);
    clearError(proposal.id);

    approveAndApply.mutate(
      {
        proposalId:  proposal.id,
        appliedText,
        reviewedBy:  user?.id ?? null,
      },
      {
        onSettled: () => setPendingApproveId(null),
        onError:   (err) => setError(proposal.id, err),
      }
    );
  };

  const handleRetryApply = (proposal: ProposalRow, appliedText?: string) => {
    setPendingRetryId(proposal.id);
    clearError(proposal.id);

    retryApply.mutate(
      { proposalId: proposal.id, appliedText },
      {
        onSettled: () => setPendingRetryId(null),
        onError:   (err) => setError(proposal.id, err),
      }
    );
  };

  const handleReturnToPending = (proposal: ProposalRow) => {
    setPendingReturnId(proposal.id);
    clearError(proposal.id);

    returnToPending.mutate(
      { proposalId: proposal.id },
      {
        onSettled: () => setPendingReturnId(null),
        onError:   (err) => setError(proposal.id, err),
      }
    );
  };

  /** Show an Alert confirmation before applying opening_hours (destructive replace). */
  const handleOpeningHoursApply = (proposal: ProposalRow) => {
    Alert.alert(
      'Replace opening hours?',
      'This will delete all existing opening hours for this venue and write the proposed 7-day schedule. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Yes, apply',
          style:   'destructive',
          onPress: () => handleApproveApply(proposal),
        },
      ]
    );
  };

  const openRejectModal = (proposalId: string) => {
    setRejectProposalId(proposalId);
    setRejectNote('');
    setRejectModalVisible(true);
  };

  const confirmRejection = () => {
    if (!rejectProposalId) return;
    const id = rejectProposalId;
    setPendingRejectId(id);

    reject.mutate(
      { proposalId: id, notes: rejectNote.trim() },
      {
        onSuccess: () => {
          setRejectModalVisible(false);
          setRejectProposalId(null);
          setRejectNote('');
        },
        onSettled: () => setPendingRejectId(null),
        onError: (err) => {
          setError(id, err);
          setRejectModalVisible(false);
          setRejectProposalId(null);
          setRejectNote('');
        },
      }
    );
  };

  const cancelRejection = () => {
    setRejectModalVisible(false);
    setRejectProposalId(null);
    setRejectNote('');
  };

  // ── Auth / admin guard (mirrors moderation.tsx exactly) ───────────────────
  if (authIsLoading || (user && !profile)) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center">
        <ActivityIndicator color="#FF6B6B" size="large" />
      </SafeAreaView>
    );
  }

  if (!isAdmin) return <Redirect href="/(tabs)" />;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>

      {/* ── Rejection modal ───────────────────────────────────────────────── */}
      <Modal
        visible={rejectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelRejection}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Reject proposal</Text>
            <Text className="text-grey text-sm mb-4">
              Enter a rejection note (required). This is recorded in the audit trail.
            </Text>
            <TextInput
              testID="reject-note-input"
              className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px]"
              multiline
              placeholder="e.g. Incorrect data, conflicts with verified source..."
              value={rejectNote}
              onChangeText={setRejectNote}
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={cancelRejection}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="reject-modal-confirm"
                className={`flex-1 rounded-xl py-3 items-center ${
                  rejectNote.trim() ? 'bg-error' : 'bg-greyLighter'
                }`}
                onPress={confirmRejection}
                disabled={!rejectNote.trim() || reject.isPending}
                accessibilityState={{ disabled: !rejectNote.trim() || reject.isPending }}
              >
                {reject.isPending && pendingRejectId === rejectProposalId
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text
                      className={`font-bold ${
                        rejectNote.trim() ? 'text-white' : 'text-grey'
                      }`}
                    >
                      Reject
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Screen header ─────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral">←</Text>
        </TouchableOpacity>
        <Text className="text-2xl font-extrabold text-charcoal">Enrichment Review</Text>
        {proposals.length > 0 && (
          <View className="bg-sky rounded-full w-6 h-6 items-center justify-center ml-2">
            <Text className="text-white text-xs font-bold">{proposals.length}</Text>
          </View>
        )}
      </View>

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {proposalsLoading && (
        <ActivityIndicator color="#FF6B6B" className="mt-8" />
      )}

      {/* ── Query error ───────────────────────────────────────────────────── */}
      {proposalsError && !proposalsLoading && (
        <View className="items-center py-12 px-6">
          <Text className="text-charcoal font-bold text-center">
            Couldn&apos;t load proposals
          </Text>
          <Text className="text-grey text-sm text-center mt-1">
            Check your admin permissions or try signing out and back in.
          </Text>
        </View>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!proposalsLoading && !proposalsError && groupedProposals.length === 0 && (
        <View className="items-center py-12">
          <Text className="text-grey">No pending enrichment proposals.</Text>
        </View>
      )}

      {/* ── Proposal list grouped by venue ────────────────────────────────── */}
      {!proposalsLoading && !proposalsError && groupedProposals.length > 0 && (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8">
          <Text className="text-grey font-bold uppercase text-xs mb-3 mt-1">
            Pending enrichment proposals
          </Text>

          {groupedProposals.map((group) => (
            <View key={group.venueId} className="mb-6">

              {/* Venue name header */}
              <View className="bg-sky/20 rounded-xl px-4 py-2 mb-2">
                <Text className="text-charcoal font-extrabold text-base">
                  {group.venueName}
                </Text>
              </View>

              {/* Proposal cards for this venue */}
              {group.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  descriptionText={descriptionTexts[proposal.id] ?? ''}
                  onDescriptionChange={(text) =>
                    setDescriptionTexts((prev) => ({ ...prev, [proposal.id]: text }))
                  }
                  proposalError={proposalErrors[proposal.id] ?? ''}
                  pendingApproveId={pendingApproveId}
                  pendingRetryId={pendingRetryId}
                  pendingReturnId={pendingReturnId}
                  pendingRejectId={pendingRejectId}
                  onApproveApply={handleApproveApply}
                  onOpeningHoursApply={handleOpeningHoursApply}
                  onRetryApply={handleRetryApply}
                  onReturnToPending={handleReturnToPending}
                  onReject={openRejectModal}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

// ── ProposalCard ──────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  descriptionText,
  onDescriptionChange,
  proposalError,
  pendingApproveId,
  pendingRetryId,
  pendingReturnId,
  pendingRejectId,
  onApproveApply,
  onOpeningHoursApply,
  onRetryApply,
  onReturnToPending,
  onReject,
}: {
  proposal: ProposalRow;
  descriptionText: string;
  onDescriptionChange: (text: string) => void;
  proposalError: string;
  pendingApproveId: string | null;
  pendingRetryId: string | null;
  pendingReturnId: string | null;
  pendingRejectId: string | null;
  onApproveApply: (proposal: ProposalRow, appliedText?: string) => void;
  onOpeningHoursApply: (proposal: ProposalRow) => void;
  onRetryApply: (proposal: ProposalRow, appliedText?: string) => void;
  onReturnToPending: (proposal: ProposalRow) => void;
  onReject: (proposalId: string) => void;
}) {
  const isApprovePending = pendingApproveId === proposal.id;
  const isRetryPending   = pendingRetryId   === proposal.id;
  const isReturnPending  = pendingReturnId  === proposal.id;
  const isRejectPending  = pendingRejectId  === proposal.id;
  const isApproved       = proposal.status === 'approved';
  const anyPending       = isApprovePending || isRetryPending || isReturnPending || isRejectPending;

  return (
    <View
      testID={`proposal-card-${proposal.id}`}
      className="bg-white rounded-2xl p-4 mb-3 shadow-sm"
    >
      {/* ── Field + status badges ────────────────────────────────────────── */}
      <View className="flex-row items-center gap-2 flex-wrap mb-2">
        <View className="bg-sandDark rounded-full px-2 py-0.5">
          <Text className="text-charcoal text-xs font-bold uppercase">
            {fieldLabel(proposal.field)}
          </Text>
        </View>

        <View className="bg-sandDark rounded-full px-2 py-0.5">
          <Text className="text-grey text-xs font-bold uppercase">
            {proposal.extraction_method}
          </Text>
        </View>

        {/* APPROVED-BUT-UNAPPLIED — step 1 done, step 2 not yet applied */}
        {isApproved && (
          <View
            testID={`approved-awaiting-apply-${proposal.id}`}
            className="bg-sky rounded-full px-2 py-0.5"
          >
            <Text className="text-white text-xs font-bold">AWAITING APPLY</Text>
          </View>
        )}

        {/* CONFLICT WARNING — proposal differs from the current stored value */}
        {proposal.conflicts_existing && (
          <View testID={`conflict-warning-${proposal.id}`} className="bg-error rounded-full px-2 py-0.5">
            <Text className="text-white text-xs font-bold">CONFLICT</Text>
          </View>
        )}

        {/* LOW CONFIDENCE WARNING */}
        {proposal.confidence === 'low' && (
          <View testID={`low-confidence-warning-${proposal.id}`} className="bg-sun rounded-full px-2 py-0.5">
            <Text className="text-charcoal text-xs font-bold">LOW CONFIDENCE</Text>
          </View>
        )}

        {/* BOOKING_URL — no target column */}
        {proposal.field === 'booking_url' && (
          <View testID={`no-apply-booking-${proposal.id}`} className="bg-sky/20 rounded-full px-2 py-0.5">
            <Text className="text-sky text-xs font-bold">NO TARGET COLUMN</Text>
          </View>
        )}
      </View>

      {/* ── Proposed value ───────────────────────────────────────────────── */}
      <FieldValueDisplay proposal={proposal} />

      {/* ── Current value ────────────────────────────────────────────────── */}
      {proposal.current_value != null && (
        <Text className="text-grey text-xs mt-1">
          <Text className="font-bold">Current: </Text>
          {proposal.field !== 'opening_hours' && proposal.field !== 'description'
            ? scalarValue(proposal.current_value)
            : '(stored — see evidence)'}
        </Text>
      )}

      {/* ── Evidence snippet ─────────────────────────────────────────────── */}
      <View className="bg-sandDark rounded-xl px-3 py-2 mt-2">
        <Text className="text-grey text-xs font-bold uppercase mb-1">Evidence</Text>
        <Text className="text-charcoal text-xs leading-4" numberOfLines={4}>
          {proposal.evidence_snippet}
        </Text>
        {proposal.evidence_raw && proposal.evidence_raw !== proposal.evidence_snippet && (
          <Text className="text-grey text-xs mt-1 italic" numberOfLines={2}>
            Raw: {proposal.evidence_raw}
          </Text>
        )}
      </View>

      {/* ── Source URL + retrieved date ──────────────────────────────────── */}
      <TouchableOpacity
        className="mt-1"
        onPress={() => Linking.openURL(proposal.source_url).catch(() => {})}
      >
        <Text className="text-sky text-xs" numberOfLines={1}>{proposal.source_url}</Text>
      </TouchableOpacity>
      <Text className="text-grey text-xs mt-0.5">
        Retrieved: {new Date(proposal.retrieved_at).toLocaleDateString('en-GB')}
      </Text>

      {/* ── Inline error (shown after a failed mutation; proposal stays) ──── */}
      {!!proposalError && (
        <View className="bg-error/10 border border-error rounded-xl px-3 py-2 mt-2">
          <Text className="text-error text-xs font-bold">{proposalError}</Text>
        </View>
      )}

      {/* ── Actions — branch on approved vs pending ───────────────────────── */}
      {isApproved ? (
        <ApprovedActions
          proposal={proposal}
          descriptionText={descriptionText}
          onDescriptionChange={onDescriptionChange}
          isRetryPending={isRetryPending}
          isReturnPending={isReturnPending}
          anyPending={anyPending}
          onRetryApply={onRetryApply}
          onReturnToPending={onReturnToPending}
        />
      ) : proposal.field === 'booking_url' ? (
        <BookingUrlActions
          proposal={proposal}
          isRejectPending={isRejectPending}
          anyPending={anyPending}
          onReject={onReject}
        />
      ) : proposal.field === 'description' ? (
        <DescriptionActions
          proposal={proposal}
          descriptionText={descriptionText}
          onDescriptionChange={onDescriptionChange}
          isApprovePending={isApprovePending}
          isRejectPending={isRejectPending}
          anyPending={anyPending}
          onApproveApply={onApproveApply}
          onReject={onReject}
        />
      ) : proposal.field === 'opening_hours' ? (
        <OpeningHoursActions
          proposal={proposal}
          isApprovePending={isApprovePending}
          isRejectPending={isRejectPending}
          anyPending={anyPending}
          onApply={onOpeningHoursApply}
          onReject={onReject}
        />
      ) : (
        <ScalarActions
          proposal={proposal}
          isApprovePending={isApprovePending}
          isRejectPending={isRejectPending}
          anyPending={anyPending}
          onApproveApply={onApproveApply}
          onReject={onReject}
        />
      )}
    </View>
  );
}

// ── FieldValueDisplay ─────────────────────────────────────────────────────────

function FieldValueDisplay({ proposal }: { proposal: ProposalRow }) {
  if (proposal.field === 'opening_hours') {
    const week = proposal.proposed_value as OpeningWeekDisplay | null;
    if (!week?.days) {
      return (
        <Text className="text-grey text-xs mt-1">Opening hours: (no structured data)</Text>
      );
    }
    const sorted = [...week.days].sort((a, b) => a.day_of_week - b.day_of_week);
    return (
      <View className="mt-1">
        <Text className="text-charcoal text-xs font-bold mb-1">Proposed hours:</Text>
        {sorted.map((day) => (
          <Text key={day.day_of_week} className="text-charcoal text-xs">
            {DAY_NAMES[day.day_of_week] ?? '?'}:{' '}
            {day.is_closed || day.intervals.length === 0
              ? 'Closed'
              : day.intervals.map((iv) => `${iv.opens}–${iv.closes}`).join(', ')}
          </Text>
        ))}
        {week.seasonal_notes && (
          <Text className="text-grey text-xs italic mt-1">{week.seasonal_notes}</Text>
        )}
      </View>
    );
  }

  const display = scalarValue(proposal.proposed_value);
  return (
    <Text className="text-charcoal text-sm font-bold mt-1" numberOfLines={3}>
      Proposed: {display}
    </Text>
  );
}

// ── Per-field action sub-components ───────────────────────────────────────────

function ScalarActions({
  proposal,
  isApprovePending,
  isRejectPending,
  anyPending,
  onApproveApply,
  onReject,
}: {
  proposal: ProposalRow;
  isApprovePending: boolean;
  isRejectPending: boolean;
  anyPending: boolean;
  onApproveApply: (proposal: ProposalRow) => void;
  onReject: (id: string) => void;
}) {
  return (
    <View className="flex-row gap-2 mt-3">
      <TouchableOpacity
        testID={`approve-apply-btn-${proposal.id}`}
        className="flex-1 bg-success rounded-xl py-3 items-center"
        disabled={anyPending}
        accessibilityState={{ disabled: anyPending }}
        onPress={() => onApproveApply(proposal)}
      >
        {isApprovePending
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text className="text-white font-bold">Approve &amp; Apply</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        testID={`reject-btn-${proposal.id}`}
        className="flex-1 bg-error rounded-xl py-3 items-center"
        disabled={anyPending}
        accessibilityState={{ disabled: anyPending }}
        onPress={() => onReject(proposal.id)}
      >
        {isRejectPending
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text className="text-white font-bold">Reject</Text>}
      </TouchableOpacity>
    </View>
  );
}

function DescriptionActions({
  proposal,
  descriptionText,
  onDescriptionChange,
  isApprovePending,
  isRejectPending,
  anyPending,
  onApproveApply,
  onReject,
}: {
  proposal: ProposalRow;
  descriptionText: string;
  onDescriptionChange: (text: string) => void;
  isApprovePending: boolean;
  isRejectPending: boolean;
  anyPending: boolean;
  onApproveApply: (proposal: ProposalRow, appliedText: string) => void;
  onReject: (id: string) => void;
}) {
  const hasText = descriptionText.trim().length > 0;
  const disabled = !hasText || anyPending;

  return (
    <View className="mt-3">
      <View className="bg-sandDark rounded-xl px-3 py-2 mb-2">
        <Text className="text-charcoal text-xs font-bold mb-1">
          Write your own description below
        </Text>
        <Text className="text-grey text-xs leading-4">
          You MUST write an ORIGINAL summary. Do not copy the extracted text above
          (copyright). The text box is intentionally blank — reference the evidence
          and source URL, then write in your own words.
        </Text>
      </View>

      <TextInput
        testID={`description-input-${proposal.id}`}
        className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px] mb-2"
        multiline
        placeholder="Write an original description for this venue..."
        value={descriptionText}
        onChangeText={onDescriptionChange}
      />

      <View className="flex-row gap-2">
        <TouchableOpacity
          testID={`approve-apply-btn-${proposal.id}`}
          className={`flex-1 rounded-xl py-3 items-center ${
            hasText ? 'bg-success' : 'bg-greyLighter'
          }`}
          disabled={disabled}
          accessibilityState={{ disabled }}
          onPress={() => onApproveApply(proposal, descriptionText.trim())}
        >
          {isApprovePending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className={`font-bold ${hasText ? 'text-white' : 'text-grey'}`}>
                Approve &amp; Apply
              </Text>}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`reject-btn-${proposal.id}`}
          className="flex-1 bg-error rounded-xl py-3 items-center"
          disabled={anyPending}
          accessibilityState={{ disabled: anyPending }}
          onPress={() => onReject(proposal.id)}
        >
          {isRejectPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className="text-white font-bold">Reject</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function OpeningHoursActions({
  proposal,
  isApprovePending,
  isRejectPending,
  anyPending,
  onApply,
  onReject,
}: {
  proposal: ProposalRow;
  isApprovePending: boolean;
  isRejectPending: boolean;
  anyPending: boolean;
  onApply: (proposal: ProposalRow) => void;
  onReject: (id: string) => void;
}) {
  return (
    <View>
      <View className="bg-sandDark rounded-xl px-3 py-2 my-2">
        <Text className="text-grey text-xs">
          Applying will REPLACE all existing opening hours for this venue with the 7-day
          schedule above. Confirm carefully before applying.
        </Text>
      </View>
      <View className="flex-row gap-2">
        <TouchableOpacity
          testID={`approve-apply-btn-${proposal.id}`}
          className="flex-1 bg-success rounded-xl py-3 items-center"
          disabled={anyPending}
          accessibilityState={{ disabled: anyPending }}
          onPress={() => onApply(proposal)}
        >
          {isApprovePending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className="text-white font-bold">Approve &amp; Apply</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`reject-btn-${proposal.id}`}
          className="flex-1 bg-error rounded-xl py-3 items-center"
          disabled={anyPending}
          accessibilityState={{ disabled: anyPending }}
          onPress={() => onReject(proposal.id)}
        >
          {isRejectPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className="text-white font-bold">Reject</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BookingUrlActions({
  proposal,
  isRejectPending,
  anyPending,
  onReject,
}: {
  proposal: ProposalRow;
  isRejectPending: boolean;
  anyPending: boolean;
  onReject: (id: string) => void;
}) {
  return (
    <View>
      <View className="bg-sky/10 border border-sky rounded-xl px-3 py-2 my-2">
        <Text className="text-charcoal text-xs font-bold mb-1">
          Cannot apply booking_url
        </Text>
        <Text className="text-grey text-xs">
          There is no booking_url column in venues yet. You can leave this pending
          until the column is added, or reject it if the data is incorrect.
        </Text>
      </View>
      <View className="flex-row gap-2">
        <View className="flex-1 bg-sandDark rounded-xl py-3 items-center">
          <Text className="text-grey font-bold">Leave Pending</Text>
        </View>
        <TouchableOpacity
          testID={`reject-btn-${proposal.id}`}
          className="flex-1 bg-error rounded-xl py-3 items-center"
          disabled={anyPending}
          accessibilityState={{ disabled: anyPending }}
          onPress={() => onReject(proposal.id)}
        >
          {isRejectPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className="text-white font-bold">Reject</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Actions for an approved-but-unapplied proposal.
 * Step 1 (UPDATE to 'approved') already succeeded; this shows Retry Apply
 * (step 2 only) and Return to Pending (revert to allow full re-review).
 * For description fields, the admin must still supply the rewritten text.
 */
function ApprovedActions({
  proposal,
  descriptionText,
  onDescriptionChange,
  isRetryPending,
  isReturnPending,
  anyPending,
  onRetryApply,
  onReturnToPending,
}: {
  proposal: ProposalRow;
  descriptionText: string;
  onDescriptionChange: (text: string) => void;
  isRetryPending: boolean;
  isReturnPending: boolean;
  anyPending: boolean;
  onRetryApply: (proposal: ProposalRow, appliedText?: string) => void;
  onReturnToPending: (proposal: ProposalRow) => void;
}) {
  const isDesc    = proposal.field === 'description';
  const hasText   = descriptionText.trim().length > 0;
  const retryDisabled = anyPending || (isDesc && !hasText);

  return (
    <View className="mt-3">
      {isDesc && (
        <>
          <View className="bg-sandDark rounded-xl px-3 py-2 mb-2">
            <Text className="text-grey text-xs">
              Retrying requires a new original description. Write it below.
            </Text>
          </View>
          <TextInput
            testID={`description-input-${proposal.id}`}
            className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px] mb-2"
            multiline
            placeholder="Write an original description for this venue..."
            value={descriptionText}
            onChangeText={onDescriptionChange}
          />
        </>
      )}

      <View className="flex-row gap-2">
        <TouchableOpacity
          testID={`retry-apply-btn-${proposal.id}`}
          className={`flex-1 rounded-xl py-3 items-center ${
            retryDisabled ? 'bg-greyLighter' : 'bg-success'
          }`}
          disabled={retryDisabled}
          accessibilityState={{ disabled: retryDisabled }}
          onPress={() =>
            onRetryApply(proposal, isDesc ? descriptionText.trim() : undefined)
          }
        >
          {isRetryPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className={`font-bold ${retryDisabled ? 'text-grey' : 'text-white'}`}>
                Retry Apply
              </Text>}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`return-to-pending-btn-${proposal.id}`}
          className="flex-1 bg-sandDark border border-greyLighter rounded-xl py-3 items-center"
          disabled={anyPending}
          accessibilityState={{ disabled: anyPending }}
          onPress={() => onReturnToPending(proposal)}
        >
          {isReturnPending
            ? <ActivityIndicator color="#charcoal" size="small" />
            : <Text className="text-charcoal font-bold">Return to Pending</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}
