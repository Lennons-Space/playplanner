/**
 * Profile tab — user account, settings, subscription.
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUALS ONLY. Structural
 * reference: .design-v2-handoff/pp2-profile.jsx (icons, row grouping, hero
 * layout, copy). Its mock data — "My reviews" sample fixtures, prefilled
 * "Sarah Mitchell" personal-detail fields, and the dead BusinessTab2
 * claim/analytics tab — is NOT ported. This screen only ever renders real
 * profile data and routes to real screens.
 *
 * Shares the same global background atmosphere and <GlassSurface/> card
 * primitive as Home/Saved/Venue Detail/Map. BlurView is banned (documented
 * Android Fabric crash — see components/ui/GlassSurface.tsx); GlassSurface
 * renders a plain tinted View, not real blur.
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/ui';
import { V2Background } from '@/components/ui/V2Background';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { HelpModal } from '@/components/profile/HelpModal';
import { Themes, FontFamily, ocean } from '@/constants/theme';

const T = Themes.dark;
const ACCENT = ocean;
// iOS-standard destructive red — matches the v2 mock's sign-out/delete copy
// (pp2-profile.jsx sign-out button: color: '#FF3B30').
const DESTRUCTIVE = '#FF3B30';

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
  iconBg = ACCENT.light,
  iconColor = ACCENT.accent,
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

      <Icon name="chevR" size={16} color={T.label3} />
    </TouchableOpacity>
  );
}

// ─── MenuGroup ───────────────────────────────────────────────────────────────
// Wraps a group of MenuItems in a dark glass card with rounded corners.
function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <GlassSurface style={styles.menuGroup}>
      {children}
    </GlassSurface>
  );
}

// ─── ProfileScreen ───────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const profile = useProfile();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  // In-app Help modal — replaces the old native Alert.alert('Help', ...)
  // call so it matches the v2 dark design language. Conditionally rendered
  // (not just Modal's own `visible` prop) so the modal's content genuinely
  // isn't in the tree while closed — deterministic under test, and avoids
  // any accessibility-tree leakage from a hidden-but-mounted sheet.
  const [helpVisible, setHelpVisible] = useState(false);

  // Tab-safe zone — same rule as Home/Saved/Map: the scroll VIEWPORT itself
  // ends above the floating glass tab bar (marginBottom on the ScrollView),
  // so content can never sit or pass beneath it. The bar only ever overlays
  // the shared background layer mounted at the app root.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const tabSafeZone = Math.max(tabBarHeight, 52 + insets.bottom);

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
      <View style={styles.root}>
        <V2Background />
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.skeletonHero} />
          <View style={styles.skeletonBlock1} />
          <View style={styles.skeletonBlock2} />
        </SafeAreaView>
      </View>
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
    <View style={styles.root}>
      {/* Same accepted v2 atmosphere as Home/Saved/Venue Detail/Map — the
          shared weather cache key + pure resolveAtmosphere() keep it
          identical across screens. Each screen mounts its own instance. */}
      <V2Background />
      {/* Local override of the tabs layout's shared "dark" status bar —
          same stacking pattern as Home/Saved; reverts on the legacy light tabs. */}
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={{ marginBottom: tabSafeZone }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >

          {/* ── Hero card ─────────────────────────────────────────────────── */}
          <GlassSurface style={styles.heroCard} tintColor="rgba(18,18,26,0.86)">
            {/* Subtle accent halo, same Ocean/violet language as the shared
                atmosphere layer — not a real blur, just a soft gradient tint. */}
            <LinearGradient
              colors={['rgba(76,141,246,0.18)', 'rgba(124,79,204,0.10)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* Top row: avatar + settings button */}
            <View style={styles.heroTopRow}>
              {/* Avatar */}
              <LinearGradient
                colors={[ACCENT.accent, 'rgba(76,141,246,0.55)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatar}
              >
                {initials.length > 0 ? (
                  <Text style={styles.avatarInitials}>{initials}</Text>
                ) : (
                  <Icon name="user" size={28} color="#FFFFFF" />
                )}
              </LinearGradient>

              {/* Settings button */}
              <TouchableOpacity
                style={styles.heroSettingsBtn}
                onPress={() => router.push('/profile/edit')}
                accessibilityRole="button"
                accessibilityLabel="Edit profile settings"
                activeOpacity={0.7}
              >
                <Icon name="settings" size={20} color={T.label2} />
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
          </GlassSurface>

          {/* ── Account ───────────────────────────────────────────────────── */}
          <SectionLabel label="Account" />
          <MenuGroup>
            <MenuItem
              icon="user"
              label="Personal details"
              onPress={() => router.push('/profile/edit')}
            />
            <MenuItem
              icon="stroller"
              label="Family"
              detail="Children's age ranges"
              onPress={() => router.push('/profile/children-ages')}
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
              onPress={() => setHelpVisible(true)}
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

          {/* ── Admin ─────────────────────────────────────────────────────── */}
          {/* Restored 2026-07-17 per Liam's instruction (was removed in
              834776e "v2 profile ecosystem" — audit found the removal was
              cosmetic only; the real security boundary was never touched).
              Hiding this row is a UX convenience, NOT the access control:
              even if this condition were deleted entirely, app/admin/
              moderation.tsx independently redirects non-admins
              (`if (!isAdmin) return <Redirect href="/(tabs)" />`) and every
              query on that screen is gated `enabled: isAdmin`, backed by
              Supabase RLS server-side. No email or user-ID is hard-coded
              here or anywhere in the admin gate — visibility is driven
              solely by the authenticated user's own profile.is_admin flag. */}
          {profile?.is_admin === true && (
            <>
              <SectionLabel label="Admin" />
              <MenuGroup>
                <MenuItem
                  icon="shield"
                  label="Admin panel"
                  onPress={() => router.push('/admin/moderation')}
                  iconBg="rgba(124,79,204,0.16)"
                  iconColor="#B299E0"
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
          <GlassSurface style={styles.signOutSurface}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={confirmSignOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out of your account"
            >
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </GlassSurface>

          {/* ── Delete account — GDPR Art.17 ──────────────────────────────── */}
          <GlassSurface style={styles.deleteWrapper} tintColor="rgba(255,59,48,0.10)">
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={confirmDeleteAccount}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Permanently delete your account and all your data"
              accessibilityState={{ disabled: deleting }}
            >
              {deleting ? (
                <ActivityIndicator color={DESTRUCTIVE} />
              ) : (
                <Text style={styles.deleteBtnText}>Delete account</Text>
              )}
            </TouchableOpacity>
            {/* ICO Children's Code Standard 4 — transparency before destructive action */}
            <Text style={styles.deleteWarning}>
              Permanently deletes all your data. Cannot be undone.
            </Text>
          </GlassSurface>

        </ScrollView>
      </SafeAreaView>

      {helpVisible && (
        <HelpModal visible={helpVisible} onClose={() => setHelpVisible(false)} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Root
  root: {
    flex: 1,
    // Transparent — V2Background (first child) is the screen's backdrop,
    // same pattern as Home/Saved/Venue Detail/Map.
    backgroundColor: 'transparent',
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingBottom: 32,
  },

  // Skeleton
  skeletonHero: {
    margin: 20,
    height: 150,
    borderRadius: 24,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
  },
  skeletonBlock1: {
    marginHorizontal: 20,
    marginTop: 20,
    height: 200,
    borderRadius: 20,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
  },
  skeletonBlock2: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 100,
    borderRadius: 20,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
  },

  // Hero card
  heroCard: {
    borderRadius: 24,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    padding: 18,
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
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  avatarInitials: {
    fontFamily: FontFamily.display,
    fontSize: 22,
    color: '#FFFFFF',
  },
  heroSettingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: T.fill,
    borderWidth: 1,
    borderColor: T.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontFamily: FontFamily.display,
    fontSize: 20,
    color: T.label,
    letterSpacing: -0.3,
    marginTop: 14,
  },
  heroUsername: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: T.label3,
    marginTop: 2,
  },
  // SectionLabel
  sectionLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: T.label3,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  // MenuGroup — dark glass card (GlassSurface owns the tint + hairline
  // border + overflow:hidden clip; this only supplies layout/shape).
  menuGroup: {
    marginHorizontal: 20,
    borderRadius: 20,
  },

  // MenuItem
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.separator,
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
    fontFamily: FontFamily.heading,
    fontSize: 15,
    color: T.label,
  },
  menuDetail: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label3,
    marginRight: 4,
  },
  menuBadge: {
    backgroundColor: ACCENT.accent,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 4,
  },
  menuBadgeText: {
    fontFamily: FontFamily.caption,
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
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label4,
  },

  // Sign out
  signOutSurface: {
    marginHorizontal: 20,
    borderRadius: 16,
  },
  signOutBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  signOutText: {
    fontFamily: FontFamily.heading,
    fontSize: 15,
    color: DESTRUCTIVE,
  },

  // Delete account
  deleteWrapper: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: DESTRUCTIVE,
    paddingVertical: 15,
    alignItems: 'center',
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  deleteBtnText: {
    fontFamily: FontFamily.heading,
    fontSize: 15,
    color: DESTRUCTIVE,
  },
  deleteWarning: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label3,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
});
