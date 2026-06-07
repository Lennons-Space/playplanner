/**
 * Profile tab — user account, settings, subscription.
 *
 * GDPR Art.17 (right to erasure): "Delete account" calls delete_own_account()
 * server-side — never the auth API directly. The function handles cascading
 * deletion and writes a GDPR audit log before removing the row.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/ui';

// ─── SectionLabel ────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={styles.sectionLabel}>
      {label.toUpperCase()}
    </Text>
  );
}

// ─── MenuItem ────────────────────────────────────────────────────────────────
interface MenuItemProps {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
  badge?: string;
  detail?: string;
  iconBg?: string;
  iconColor?: string;
  last?: boolean;
}

function MenuItem({
  icon,
  label,
  onPress,
  badge,
  detail,
  iconBg = '#EEF9F8',
  iconColor = '#1B8A85',
  last = false,
}: MenuItemProps) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, last ? styles.menuItemLast : styles.menuItemBorder]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Icon box */}
      <View style={[styles.menuIconBox, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={18} color={iconColor} />
      </View>

      <Text style={styles.menuLabel}>{label}</Text>

      {detail && !badge && (
        <Text style={styles.menuDetail}>{detail}</Text>
      )}

      {badge && (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      )}

      <Icon name="chevR" size={16} color="#7B8794" />
    </TouchableOpacity>
  );
}

// ─── MenuGroup ───────────────────────────────────────────────────────────────
// Wraps a group of MenuItems in a card with rounded corners.
function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.menuGroup}>
      {children}
    </View>
  );
}

// ─── ProfileScreen ───────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const profile = useProfile();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          // Await signOut so the Supabase token is invalidated before we
          // clear the React Query cache. If signOut throws (e.g. offline),
          // local state is still wiped — the session token is useless on
          // a device that has lost connectivity anyway.
          try { await signOut(); } catch { /* local state cleared regardless */ }
          queryClient.clear();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }

  /**
   * GDPR Art.17 — right to erasure.
   *
   * Order matters here and is privacy-load-bearing:
   *   1. Remove this user's UNAPPROVED (pending/rejected) photo files from
   *      Storage first. Supabase Storage objects live outside Postgres, so
   *      a SQL-only deletion can't reach them — the RPC below deletes the
   *      DB rows, but the blobs would be orphaned without this step.
   *      Best-effort: a storage error must NEVER block account deletion —
   *      the DB rows (the source of truth for "is this still personal
   *      data?") are removed by the RPC regardless.
   *   2. Call delete_own_account(), which:
   *        a. Writes a GDPR audit log entry (Art.5(2) accountability).
   *        b. Deletes this user's unapproved photo ROWS (status <> 'approved').
   *        c. Deletes the auth.users row, cascading to profiles and all
   *           ON DELETE CASCADE tables, and ANONYMISING (uploaded_by/
   *           moderated_by → NULL) any APPROVED photos this user uploaded
   *           or moderated — they are kept as anonymous venue content.
   *
   * Approved photos' files are intentionally left in Storage — their DB
   * rows survive (now anonymised), so the files are still in active use.
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

            // Step 1 — best-effort cleanup of this user's own unapproved
            // photo files. Scoped to `uploaded_by = user.id` so we can never
            // touch another user's or an admin's storage objects. We never
            // log the storage paths or any photo/user identifiers — only
            // generic error metadata (code/message), per the "no sensitive
            // logs" rule, since paths are a (weak) link back to the user.
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
                // Never let a storage hiccup prevent account deletion — the
                // RPC is the authoritative deletion path for the DB rows.
                console.error('[deleteAccount] Unexpected error during storage cleanup (non-blocking):', e instanceof Error ? e.message : 'unknown');
              }
            }

            // Step 2 — the authoritative deletion. Removes unapproved photo
            // rows, deletes the account, and anonymises any approved photos.
            const { error } = await supabase.rpc('delete_own_account');
            if (error) {
              // Only re-enable the button on failure. On success we leave
              // deleting=true — the screen is replaced immediately so the
              // state never resets, and this prevents the button briefly
              // re-enabling between the RPC resolving and navigation firing.
              setDeleting(false);
              Alert.alert('Error', 'Could not delete account. Please try again.');
              return;
            }

            queryClient.clear();
            // signOut is best-effort — the DB row is gone so the session is
            // invalid regardless. We clear local state but don't block on failure.
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

  // ── Auth guard — must come after all hooks (Rules of Hooks) ─────────────
  // If there is no authenticated user, redirect to the welcome screen rather
  // than showing a skeleton that will never resolve.
  if (!user) return <Redirect href="/(auth)/welcome" />;

  // isPremium intentionally not used — subscription tier is not surfaced in UI
  // until the Pass product re-launches. Keeping the data read here means we
  // don't need a migration when we restore the badge.
  const isPremium = false;

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (!profile) {
    return (
      <SafeAreaView style={styles.skeletonRoot} edges={['top']}>
        <View style={styles.skeletonHero} />
        <View style={styles.skeletonBlock1} />
        <View style={styles.skeletonBlock2} />
      </SafeAreaView>
    );
  }

  // ── Derive initials for avatar ────────────────────────────────────────────
  const initials = profile.full_name
    ?.trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('') ?? '';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* ── Hero card ─────────────────────────────────────────────────── */}
        <LinearGradient
          colors={['#D4F0EE', '#EEF9F8', '#FFF1C7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* Top row: avatar + settings button */}
          <View style={styles.heroTopRow}>
            {/* Avatar */}
            <View style={styles.avatar}>
              {initials.length > 0 ? (
                <Text style={styles.avatarInitials}>{initials}</Text>
              ) : (
                <Icon name="user" size={28} color="#FFFFFF" />
              )}
            </View>

            {/* Settings button */}
            <TouchableOpacity
              style={styles.heroSettingsBtn}
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              accessibilityLabel="Edit profile settings"
              activeOpacity={0.7}
            >
              <Icon name="settings" size={20} color="#4A5560" />
            </TouchableOpacity>
          </View>

          {/* Name */}
          <Text style={styles.heroName}>
            {profile.full_name ?? 'Parent'}
          </Text>

          {/* Username */}
          {profile.username ? (
            <Text style={styles.heroUsername}>@{profile.username}</Text>
          ) : null}

          {/* Premium badge placeholder — hidden until Pass relaunches */}
        </LinearGradient>

        {/* ── Account ───────────────────────────────────────────────────── */}
        <SectionLabel label="Account" />
        <MenuGroup>
          <MenuItem
            icon="user"
            label="Personal details"
            onPress={() => router.push('/profile/edit')}
          />
          <MenuItem
            icon="bell"
            label="Notifications"
            onPress={() => router.push('/profile/notifications')}
          />
          <MenuItem
            icon="shield"
            label="Privacy & data"
            onPress={() => router.push('/profile/privacy-settings')}
          />
          <MenuItem
            icon="info"
            label="Download my data"
            onPress={() => router.push('/profile/data-download')}
            last
          />
        </MenuGroup>

        {/* ── My Activity ───────────────────────────────────────────────── */}
        <SectionLabel label="My activity" />
        <MenuGroup>
          <MenuItem
            icon="star"
            label="My reviews"
            onPress={() => router.push('/profile/my-reviews')}
          />
          <MenuItem
            icon="pin"
            label="My submitted venues"
            onPress={() => router.push('/profile/my-venues')}
            last
          />
        </MenuGroup>

        {/* Subscription / upsell section intentionally removed.
            PlayPlanner is free to use at launch. The Pass will be
            reintroduced in a future release once payment infrastructure
            is fully hardened. Remove this comment when reinstating. */}

        {/* ── Community ─────────────────────────────────────────────────── */}
        <SectionLabel label="Community" />
        <MenuGroup>
          <MenuItem
            icon="plus"
            label="Add a venue"
            onPress={() => router.push('/venue/add')}
            last
          />
        </MenuGroup>

        {/* "Own a venue?" claim card intentionally removed.
            The claim flow is being redesigned for security before re-launch.
            Edge functions send-otp / verify-otp remain deployed server-side.
            Remove this comment and restore the card when the flow is ready. */}

        {/* ── Support ───────────────────────────────────────────────────── */}
        <SectionLabel label="Support" />
        <MenuGroup>
          <MenuItem
            icon="info"
            label="Help & FAQ"
            onPress={() => Alert.alert('Help', 'For help, email support@playplanner.app')}
          />
          <MenuItem
            icon="msg"
            label="Contact us"
            onPress={() => Linking.openURL('mailto:support@playplanner.app')}
          />
          <MenuItem
            icon="shield"
            label="Privacy policy"
            onPress={() => router.push('/(auth)/privacy')}
            last
          />
        </MenuGroup>

        {/* ── Admin panel — only visible to admins ──────────────────────── */}
        {profile?.is_admin === true && (
          <>
            <SectionLabel label="Admin" />
            <MenuGroup>
              <MenuItem
                icon="shield"
                label="Moderation panel"
                onPress={() => router.push('/admin/moderation')}
                iconBg="#FFF1C7"
                iconColor="#8A6100"
                last
              />
            </MenuGroup>
          </>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>PlayPlanner · v1.0.0</Text>
        </View>

        {/* ── Sign out ──────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={confirmSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out of your account"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* ── Delete account — GDPR Art.17 ──────────────────────────────── */}
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
              <ActivityIndicator color="#FF6B6B" />
            ) : (
              <Text style={styles.deleteBtnText}>Delete account</Text>
            )}
          </TouchableOpacity>
          {/* ICO Children's Code Standard 4 — transparency before destructive action */}
          <Text style={styles.deleteWarning}>
            Permanently deletes all your data. Cannot be undone.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Root
  root: {
    flex: 1,
    backgroundColor: '#FBF6EC',
  },
  scrollContent: {
    paddingBottom: 96,
  },

  // Skeleton
  skeletonRoot: {
    flex: 1,
    backgroundColor: '#FBF6EC',
  },
  skeletonHero: {
    margin: 16,
    height: 140,
    borderRadius: 24,
    backgroundColor: '#F1ECE2',
  },
  skeletonBlock1: {
    marginHorizontal: 16,
    marginTop: 20,
    height: 200,
    borderRadius: 16,
    backgroundColor: '#F1ECE2',
  },
  skeletonBlock2: {
    marginHorizontal: 16,
    marginTop: 12,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#F1ECE2',
  },

  // Hero card
  heroCard: {
    borderRadius: 24,
    margin: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E6E2DB',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1D2630',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  avatarInitials: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 22,
    color: '#FFFFFF',
  },
  heroSettingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 20,
    color: '#1D2630',
    letterSpacing: -0.3,
    marginTop: 12,
  },
  heroUsername: {
    fontFamily: 'Nunito-Bold',
    fontSize: 12,
    color: '#4A5560',
    marginTop: 2,
  },
  // SectionLabel
  sectionLabel: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: '#7B8794',
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  // MenuGroup
  menuGroup: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

  // MenuItem
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6E2DB',
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    fontFamily: 'Nunito-Bold',
    fontSize: 14,
    color: '#1D2630',
  },
  menuDetail: {
    fontFamily: 'Nunito-Bold',
    fontSize: 12,
    color: '#7B8794',
    marginRight: 4,
  },
  menuBadge: {
    backgroundColor: '#2FB8B0',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 4,
  },
  menuBadgeText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: '#FFFFFF',
  },

  // Upgrade card styles removed — subscription upsell removed at launch.
  // Restore when PlayPlanner Pass relaunches.

  // Claim card styles removed — claim flow removed at launch for security.

  // Footer
  footer: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 12,
  },
  footerText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#7B8794',
  },

  // Sign out
  signOutBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  signOutText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#FF6B6B',
  },

  // Delete account
  deleteWrapper: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 48,
    backgroundColor: '#FFE8E8',
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
  },
  deleteBtnText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#FF6B6B',
  },
  deleteWarning: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#7B8794',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
});
