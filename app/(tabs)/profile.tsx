/**
 * Profile tab — Play Planner v2 (Parent experience).
 *
 * Rebuilt to the v2 design (pp2-profile.jsx / screens/05-profile-dark.png):
 * brand splash (mark + wordmark) → user row (avatar, name, location · member
 * since, Edit) → stats row → grouped settings sections → sign out → delete.
 *
 * Per launch decision: the Parent/Business toggle and all business-owner flows
 * (claim listing, analytics, edit listing) are intentionally NOT rendered — they
 * were deferred/removed for launch. This screen shows only real, existing
 * functionality.
 *
 * GDPR Art.17 (right to erasure): "Delete account" calls delete_own_account()
 * server-side — never the auth API directly. The function handles cascading
 * deletion and writes a GDPR audit log before removing the row. The sign-out and
 * delete logic below is preserved verbatim from the previous version.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useSavedVenueIds } from '@/hooks/useFavourites';
import { supabase } from '@/lib/supabase';
import { Icon, PPBrandMark } from '@/components/ui';
import type { IconName } from '@/components/ui/Icon';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

// ─── Settings row + section ──────────────────────────────────────────────────
interface RowProps {
  icon: IconName;
  label: string;
  sub?: string;
  onPress: () => void;
  last?: boolean;
}

function SettingsRow({ icon, label, sub, onPress, last = false }: RowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={Colors.accent} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Icon name="chevR" size={16} color={Colors.label4} />
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// ─── ProfileScreen ───────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const profile = useProfile();
  const user = useAuthStore((s) => s.user);
  const authUser = useUser();
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [deleting, setDeleting] = useState(false);

  // ── Real stats (failure-safe: a count error simply shows "—") ──────────────
  const { savedIds } = useSavedVenueIds();
  const { data: reviewCount } = useQuery({
    queryKey: ['profileStats', 'reviews', authUser?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', authUser!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!authUser,
    staleTime: 1000 * 60 * 2,
  });
  const { data: submittedCount } = useQuery({
    queryKey: ['profileStats', 'submitted', authUser?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('venues')
        .select('id', { count: 'exact', head: true })
        .eq('submitted_by', authUser!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!authUser,
    staleTime: 1000 * 60 * 2,
  });

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try { await signOut(); } catch { /* local state cleared regardless */ }
          queryClient.clear();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }

  /**
   * GDPR Art.17 — right to erasure. (Logic preserved verbatim.)
   * 1. Best-effort removal of this user's UNAPPROVED photo files from Storage.
   * 2. delete_own_account() RPC: audit log → delete unapproved photo rows →
   *    delete auth.users (cascades), anonymising approved photos.
   */
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);

            if (user) {
              try {
                const { data: ownPhotos, error: fetchError } = await supabase
                  .from('venue_photos')
                  .select('storage_path')
                  .eq('uploaded_by', user.id)
                  .neq('status', 'approved');

                if (fetchError) {
                  console.error('[deleteAccount] Could not list unapproved photos for storage cleanup:', fetchError.code ?? fetchError.message);
                } else {
                  const paths = (ownPhotos ?? [])
                    .map((p) => p.storage_path)
                    .filter((p): p is string => typeof p === 'string' && p.length > 0);

                  if (paths.length > 0) {
                    const { error: removeError } = await supabase.storage
                      .from('venue-photos')
                      .remove(paths);
                    if (removeError) {
                      console.error('[deleteAccount] Storage cleanup failed (non-blocking):', removeError.message);
                    }
                  }
                }
              } catch (e) {
                console.error('[deleteAccount] Unexpected error during storage cleanup (non-blocking):', e instanceof Error ? e.message : 'unknown');
              }
            }

            const { error } = await supabase.rpc('delete_own_account');
            if (error) {
              setDeleting(false);
              Alert.alert('Error', 'Could not delete account. Please try again.');
              return;
            }

            queryClient.clear();
            try {
              await signOut();
            } catch (e) {
              console.error('signOut failed after account delete (non-blocking):', e instanceof Error ? e.message : String(e));
            }
            router.replace('/(auth)/welcome');
          },
        },
      ]
    );
  }

  // ── Auth guard — after all hooks (Rules of Hooks) ──────────────────────────
  if (!user) return <Redirect href="/(auth)/welcome" />;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (!profile) {
    return (
      <View style={styles.root}>
        <View style={[styles.brandSplash, { paddingTop: insets.top + 14 }]}>
          <View style={{ height: 200 }} />
        </View>
      </View>
    );
  }

  // Single-initial avatar (matches v2).
  const initial = profile.full_name?.trim()?.[0]?.toUpperCase() ?? '';

  // Location · member-since line (real data only; pieces hide when absent).
  const memberSinceYear = profile.created_at ? new Date(profile.created_at).getFullYear() : null;
  const locationBits = [profile.postcode?.trim() || null, memberSinceYear ? `Member since ${memberSinceYear}` : null].filter(Boolean);
  const subline = locationBits.join(' · ');

  const stat = (n: number | undefined) => (n == null ? '—' : String(n));

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ── Brand splash + user row + stats ─────────────────────────────── */}
        <View style={[styles.brandSplash, { paddingTop: insets.top + 14 }]}>
          <View style={styles.brandRow}>
            <PPBrandMark size={36} />
            <Text style={styles.wordmark}>Play Planner</Text>
          </View>

          {/* User row */}
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              {initial ? (
                <Text style={styles.avatarInitial}>{initial}</Text>
              ) : (
                <Icon name="user" size={26} color="#FFFFFF" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{profile.full_name ?? 'Parent'}</Text>
              {subline ? <Text style={styles.userSub} numberOfLines={1}>{subline}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Stats row — real counts, each tappable to its screen */}
          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statCell} onPress={() => router.push('/(tabs)/favourites')} accessibilityRole="button" accessibilityLabel={`${savedIds.size} saved`}>
              <Text style={styles.statValue}>{savedIds.size}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity style={styles.statCell} onPress={() => router.push('/profile/my-reviews')} accessibilityRole="button" accessibilityLabel={`${stat(reviewCount)} reviews`}>
              <Text style={styles.statValue}>{stat(reviewCount)}</Text>
              <Text style={styles.statLabel}>Reviews</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity style={styles.statCell} onPress={() => router.push('/profile/my-venues')} accessibilityRole="button" accessibilityLabel={`${stat(submittedCount)} submitted`}>
              <Text style={styles.statValue}>{stat(submittedCount)}</Text>
              <Text style={styles.statLabel}>Submitted</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Settings sections (Parent only) ─────────────────────────────── */}
        <View style={{ paddingTop: 18 }}>
          <Section title="Account">
            <SettingsRow icon="user" label="Personal details" sub="Name, username, postcode" onPress={() => router.push('/profile/edit')} />
            <SettingsRow icon="bell" label="Notifications" sub="Nearby events & updates" onPress={() => router.push('/profile/notifications')} />
            <SettingsRow icon="shield" label="Privacy & safety" sub="Location, data settings" onPress={() => router.push('/profile/privacy-settings')} />
            <SettingsRow icon="info" label="Download my data" sub="Export a copy of your data" onPress={() => router.push('/profile/data-download')} last />
          </Section>

          <Section title="My activity">
            <SettingsRow icon="star" label="My reviews" onPress={() => router.push('/profile/my-reviews')} />
            <SettingsRow icon="pin" label="My submitted venues" onPress={() => router.push('/profile/my-venues')} last />
          </Section>

          <Section title="Community">
            <SettingsRow icon="plus" label="Add a venue" sub="Suggest a family-friendly place" onPress={() => router.push('/venue/add')} last />
          </Section>

          <Section title="Support">
            <SettingsRow icon="info" label="Help & FAQ" onPress={() => Alert.alert('Help', 'For help, email support@playplanner.app')} />
            <SettingsRow icon="msg" label="Contact us" sub="We usually reply same day" onPress={() => Linking.openURL('mailto:support@playplanner.app')} />
            <SettingsRow icon="shield" label="Privacy policy" onPress={() => router.push('/(auth)/privacy')} last />
          </Section>

          {profile?.is_admin === true && (
            <Section title="Admin">
              <SettingsRow icon="shield" label="Moderation panel" onPress={() => router.push('/admin/moderation')} last />
            </Section>
          )}

          {/* Sign out */}
          <View style={{ paddingHorizontal: 16 }}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={confirmSignOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out of your account"
            >
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>

          {/* Delete account — GDPR Art.17 */}
          <View style={styles.deleteWrapper}>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={confirmDeleteAccount}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Permanently delete your account and all your data"
              accessibilityState={{ disabled: deleting }}
            >
              {deleting ? (
                <ActivityIndicator color={Colors.coral} />
              ) : (
                <Text style={styles.deleteBtnText}>Delete account</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.deleteWarning}>
              Permanently deletes all your data. Cannot be undone.
            </Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>PlayPlanner · v1.0.0</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Transparent so the global weather layer shows through the rounded areas.
    backgroundColor: 'transparent',
  },

  // ── Brand splash ──
  brandSplash: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 18,
  },
  wordmark: {
    fontFamily: FontFamily.display,
    fontSize: 18,
    color: Colors.label,
    letterSpacing: -0.4,
  },

  // ── User row ──
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FontFamily.caption,
    fontSize: 22,
    color: '#FFFFFF',
  },
  userName: {
    fontFamily: FontFamily.display,
    fontSize: 20,
    color: Colors.label,
    letterSpacing: -0.3,
  },
  userSub: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: Colors.label3,
    marginTop: 2,
  },
  editBtn: {
    backgroundColor: Colors.fill,
    borderRadius: BorderRadius.iconContainer,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  editBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: Colors.accent,
  },

  // ── Stats ──
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.separator,
  },
  statValue: {
    fontFamily: FontFamily.display,
    fontSize: 22,
    color: Colors.accent,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
    marginTop: 2,
  },

  // ── Settings sections ──
  sectionLabel: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: Colors.label3,
    letterSpacing: 0.6,
    marginLeft: 16,
    marginBottom: 8,
  },
  sectionCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.section,
    borderWidth: 1,
    borderColor: Colors.separator,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.separator,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.iconContainer,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: Colors.label,
  },
  rowSub: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: Colors.label3,
    marginTop: 1,
  },

  // ── Sign out ──
  signOutBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: BorderRadius.section,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: Colors.coral,
  },

  // ── Delete account ──
  deleteWrapper: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  deleteBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: Colors.coral,
  },
  deleteWarning: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
  },

  // ── Footer ──
  footer: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 12,
  },
  footerText: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
  },
});
