/**
 * Privacy Policy screen — UK GDPR Article 13 transparency notice.
 * Displayed at registration and accessible from Profile > Privacy Settings.
 *
 * This policy covers all data processing activities in PlayPlanner v1.0:
 * account data, location consent logging, reviews, photos, and GDPR rights.
 *
 * Data controller: Liam Evanson trading as PlayPlanner
 * Contact: privacy@playplanner.app
 *
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * legal wording below (including every "Last updated" line) is
 * byte-identical to the pre-restyle version — only the container/typography
 * changed. Mounts <V2Background/> per the frozen background architecture
 * (see app/(tabs)/profile.tsx) and reuses <V2Header/> for the single
 * back + title header, matching the pattern already used under app/profile/.
 */
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily } from '@/constants/theme';

export default function PrivacyScreen() {
  const { tokens: T, mode } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <V2Header title="Privacy Policy" />

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.lastUpdated, { color: T.label3 }]}>Last updated: September 2026</Text>

          <Section title="1. Who we are">
            PlayPlanner is a family venue discovery app. The data controller is Liam Evanson trading as
            PlayPlanner, based in the United Kingdom.{'\n\n'}
            If you have any questions about how we handle your personal data, or wish to exercise your
            rights, contact us at:{'\n'}
            privacy@playplanner.app
          </Section>

          <Section title="2. What personal data we collect">
            We collect only the data we need to provide the service.{'\n\n'}
            <Bold>Account data</Bold>
            {'\n'}• Email address — required to create and secure your account.{'\n'}
            • Password — stored as a secure hash; we never see your plaintext password.{'\n'}
            • Display name — visible to other users on reviews you write.{'\n'}
            • Username — optional; visible to other users if set.{'\n'}
            • Profile photo — optional; visible to other users if set.{'\n'}
            • Bio — optional; visible to other users if set.{'\n\n'}
            <Bold>Family information</Bold>
            {'\n'}• Children's age ranges (e.g. "2–4", "5–7") — optional; stored as broad bands only.
            Exact dates of birth are never collected.{'\n'}
            • Postcode — optional; used only to show venues near your area.{'\n\n'}
            <Bold>Location data</Bold>
            {'\n'}• Device location — only accessed with your explicit permission, and only for
            features that need it (nearby-venue search, the interactive map, and local weather). See
            section 4 for exactly how each of these uses it, since they are not all handled the same
            way.{'\n'}
            • A record that you gave or refused location permission is stored for GDPR accountability
            purposes. It does not contain your coordinates. See section 4 for what it does
            contain.{'\n\n'}
            <Bold>Content you create</Bold>
            {'\n'}• Venue reviews — including rating, visit date, and any age ranges you add.{'\n'}
            • Venue photos — images you upload showing venues; please don't include identifiable
            people in photos you upload. Photos are stripped of EXIF metadata (including any GPS
            tags) before being stored. See section 8 for what happens to your photos if you delete
            your account.{'\n'}
            • Venue submissions — information about venues you add to the app. Submissions are held for moderation before publication and are not visible to other users while under review.{'\n\n'}
            <Bold>Venue facility votes</Bold>
            {'\n'}• When you vote on parent-reported venue facilities (e.g. "has baby change", "has
            parking"), your individual vote is stored privately and linked to your account. Only
            the aggregate count is visible publicly — your individual response is never shown to
            other users. Votes are deleted when you delete your account.{'\n\n'}
            <Bold>Push notification tokens</Bold>
            {'\n'}• If you enable push notifications, we store a push notification token provided by
            your device to send you relevant alerts. To actually deliver a notification, this token
            and the notification's content are sent to Expo, and onward through Google's and Apple's
            push systems — see "Who we share your data with" below.
            You can disable notifications at any time in your device settings. Tokens are deleted
            when you delete your account.{'\n\n'}
            <Bold>Technical data</Bold>
            {'\n'}• Session tokens — stored securely on your device to keep you logged in.{'\n'}
            • GDPR audit log entries — records of consent events (e.g. terms accepted, location
            consent granted) for legal accountability under UK GDPR Article 5(2). These records
            contain a user ID, an action type, a timestamp, and which record was affected — never
            your personal content such as review text or photos.
          </Section>

          <Section title="3. Why we collect it and our lawful basis">
            Under UK GDPR, we must have a lawful basis for each processing activity.{'\n\n'}
            • <Bold>Providing the app and your account</Bold> — contract (Article 6(1)(b)). We need
            your email, password, and display name to create and manage your account.{'\n\n'}
            • <Bold>Location-based venue search</Bold> — consent (Article 6(1)(a)). We ask for your
            explicit permission before accessing device location. You can withdraw consent at any time
            in Profile &gt; Privacy Settings.{'\n\n'}
            • <Bold>Children's age ranges and postcode</Bold> — consent (Article 6(1)(a)). These are
            optional fields you choose to provide. You can delete them at any time.{'\n\n'}
            • <Bold>Marketing emails</Bold> — consent (Article 6(1)(a) + PECR). We will only send
            marketing emails if you explicitly opt in. You can unsubscribe at any time.{'\n\n'}
            • <Bold>Reviews and photos</Bold> — contract (Article 6(1)(b)). Submitting a review or
            photo is a feature of the service you have asked to use.{'\n\n'}
            • <Bold>GDPR audit logging</Bold> — legal obligation (Article 6(1)(c)) and legitimate
            interests (Article 6(1)(f)). We are required to demonstrate that consent was given and
            that data subject rights were respected.{'\n\n'}
            • <Bold>Fraud prevention and platform safety</Bold> — legitimate interests (Article
            6(1)(f)). We take reasonable steps to prevent fake reviews, spam, and misuse.
          </Section>

          <Section title="4. Location data — additional detail">
            Location data receives additional protection because of its sensitivity. It is used
            differently depending on which feature you're using — here is each path.{'\n\n'}
            • <Bold>Off by default.</Bold> We never access location without your explicit
            permission, granted through the app's own location flow (not requested at app
            start).{'\n'}
            • <Bold>No background location tracking.</Bold> We do not request "always on" location
            permission.{'\n'}
            • <Bold>Nearby-venue search:</Bold> before we query our own venue database, we round
            your coordinates to approximately 100 metres (3 decimal places). The rounded value is
            used only for that query and is not stored on our servers afterwards.{'\n'}
            • <Bold>The interactive map:</Bold> when you turn location on and open the map, the
            native Google Maps SDK obtains your device's location directly from your phone's
            operating system to show your position on the map — this does not go through our own
            rounding step. See "Who we share your data with" for what Google does with this and how
            precision differs by platform.{'\n'}
            • <Bold>Local weather:</Bold> once you have granted location permission, we may use your
            device's last-known location, rounded to about 0.1 degrees (roughly 11 km), to request
            the local weather forecast from Open-Meteo. This does not itself prompt for a new
            permission — it only uses a permission you have already granted elsewhere in the
            app.{'\n'}
            • We keep an accountability record of your location-permission choice: whether you
            granted or withdrew consent, when, and which version of this policy was in force. It is
            linked to your account while your account exists, and does <Bold>not</Bold> contain your
            location coordinates. This log exists to meet our ICO accountability obligations.{'\n'}
            • You can revoke location permission at any time in Profile &gt; Privacy Settings, or in
            your device's system settings — this stops all of the above.
          </Section>

          <Section title="5. Children's data">
            PlayPlanner accounts are intended for parents and carers aged 18 and over. Some browsing
            and search functionality is accessible without creating an account. We take the ICO's
            Age-Appropriate Design Code (Children's Code) seriously and apply privacy-protective
            measures throughout the app, including: location access that is off by default and, on
            Android, limited to approximate location only; no behavioural advertising and no
            advertising profiles built about you; no analytics or tracking of any kind; and data
            minimisation for any information about children. Venue recommendations are ranked using
            each venue's own information (category, price, ratings), the current weather, and
            filters you choose — not by automatically building a profile of your behaviour over
            time. We keep our approach to the Children's Code under ongoing review.{'\n\n'}
            • We do not knowingly collect data from children under 13.{'\n'}
            • You can optionally provide the age ranges of children in your family (e.g. "0–2 years",
            "3–5 years"). These are used only to personalise venue recommendations for your family.
            We store them only as broad bands — never exact dates of birth, never children's names
            or images.{'\n'}
            • Children's age data is never shared publicly, never used for advertising, and is
            deleted when you delete your account.{'\n'}
            • You can delete children's age ranges at any time in Profile &gt; Edit Profile.{'\n\n'}
            If you believe a child under 13 has created an account, please contact us at
            privacy@playplanner.app and we will delete the account promptly.
          </Section>

          <Section title="6. Who we share your data with">
            We do not sell your data. We do not share it with advertisers.{'\n\n'}
            Most of the companies below only handle data on our instructions, under a data processing
            agreement. <Bold>Google is different</Bold> — for maps it acts as its own data controller,
            deciding for itself how it uses what it receives, so Google's own privacy policy governs
            that use rather than ours.{'\n\n'}
            • <Bold>Supabase</Bold> — our database and authentication provider. Stores account data,
            reviews and photos on our behalf. Our database is hosted in <Bold>London, United
            Kingdom</Bold>. Some of Supabase's own support and infrastructure providers operate
            outside the UK, under UK-approved data transfer safeguards.{'\n\n'}
            • <Bold>Google LLC</Bold> — the Google Maps SDK provides the map. Google's own Maps terms
            state that it collects search terms, IP addresses and latitude/longitude coordinates, and
            uses them for its own purposes. <Bold>When you turn location on and open the map, the
            Google Maps SDK receives your device's location directly from your phone's operating
            system</Bold> — the rounding we apply elsewhere does not apply to it. On Android,
            PlayPlanner only ever requests <Bold>approximate</Bold> location, so the map cannot hand
            Google anything more precise than that. On iOS, the permission you grant may allow more
            precise positioning unless you have turned off "Precise Location" for PlayPlanner in your
            device's Settings. If you would rather not share location with Google at all, decline the
            location permission: the map still works from a default location. Google's privacy policy
            applies: policies.google.com/privacy{'\n\n'}
            • <Bold>Open-Meteo</Bold> — provides the weather shown in the app. If you have turned
            location on, we send <Bold>your own approximate location, rounded to about 11 km</Bold>,
            so the weather matches roughly where you are. If you have not, a general Great Britain
            default is sent instead. No account details, name or device identifier is ever included.
            {'\n\n'}
            • <Bold>Stripe</Bold> — used for the venue-owner business subscription (paid listing
            upgrades). If you are a venue owner and purchase a paid listing, Stripe processes your
            payment card data; PlayPlanner never sees or stores your card number. Paid subscriptions
            for regular user accounts are not currently live. Stripe also acts as its own controller
            for fraud prevention and anti-money-laundering checks it is legally required to carry
            out. Stripe's privacy policy applies: stripe.com/gb/privacy{'\n\n'}
            • <Bold>Expo (650 Industries, Inc.)</Bold> — builds and delivers the app, and
            <Bold> only if you switch push notifications on</Bold>, relays those notifications. For
            delivery, Expo receives your device's push token and the notification's content, which can
            include the name of a venue you reviewed. Expo passes this on through Google's and Apple's
            push systems to reach your phone. Expo states that it stores push tokens to send
            notifications and does not store notification content beyond the time needed to deliver it
            — that is Expo's stated practice, not something we can independently guarantee.
            Expo's privacy policy applies: expo.dev/privacy{'\n\n'}
            We may share data if required to do so by law, a court order, or a regulatory authority.
            We will tell you if this happens unless legally prohibited from doing so.
          </Section>

          <Section title="7. International data transfers">
            Our database, authentication and file storage (Supabase) are hosted in <Bold>London,
            United Kingdom</Bold> — for that data there is no international transfer at all. Some of
            our other providers (see section 6) are based outside the UK, including in the United
            States. Where a transfer outside the UK is required, we rely on appropriate safeguards
            such as UK-approved Standard Contractual Clauses, the UK International Data Transfer
            Addendum, or a provider's Data Privacy Framework certification, depending on the provider.
          </Section>

          <Section title="8. How long we keep your data">
            • <Bold>Account data</Bold> — kept for as long as your account is active. Deleting your
            account in the app removes it immediately; if you request deletion by email instead, we
            action it within 30 days. Some records are retained beyond deletion where a legal
            retention obligation applies (see below).{'\n'}
            • <Bold>Reviews, facility votes, favourites and notification settings</Bold> — kept
            until you delete them, or until your account is deleted, whichever comes first. Deleting
            your account removes all of these immediately.{'\n'}
            • <Bold>Photos awaiting or refused moderation</Bold> — if your account is deleted before
            a photo you uploaded has been approved (i.e. it is still pending review, or was
            rejected), that photo and its image file are permanently deleted along with your
            account.{'\n'}
            • <Bold>Approved venue photos</Bold> — once a photo you uploaded has been approved and
            published, it shows a place, not a person (we strip EXIF/GPS data before storing it).
            If you delete your account, we keep the published image as anonymous venue content for
            other parents to see, but we permanently remove the link to you — the photo is no
            longer associated with your account or identity in any way.{'\n'}
            • <Bold>Location consent log entries</Bold> — our target retention period is 3 years for
            ICO accountability purposes. We are in the process of deploying the automated deletion for
            this; until it is fully in place, these records may be retained a short time beyond 3
            years, and are periodically reviewed for deletion.{'\n'}
            • <Bold>GDPR audit log entries</Bold> — same target retention (3 years) and same
            in-progress automation as above.{'\n'}
            • <Bold>Payment records</Bold> — Stripe retains transaction records in line with their
            legal obligations (typically 7 years for financial records).{'\n\n'}
            You can download a copy of the personal data we hold about you — including your
            profile, reviews, favourites, submitted venues, and location-consent history — at any
            time in Profile &gt; Download my data. A small number of records (such as individual
            facility votes and uploaded photos) are not yet included in that automated export; email
            us if you would like a copy of those specifically. You can delete your account, and the
            personal data linked to it, in Profile &gt; Delete account — see section 9 for exactly
            what happens to each type of data.
          </Section>

          <Section title="9. Your rights under UK GDPR">
            You have the following rights. To exercise any of them, contact privacy@playplanner.app
            or use the in-app controls in Profile &gt; Privacy Settings.{'\n\n'}
            • <Bold>Right of access (Article 15)</Bold> — request a copy of the personal data we
            hold about you. Use the "Download my data" feature in the app for an instant export
            covering most of it (see section 8 for what's included); email us for anything not yet
            covered by that export.{'\n\n'}
            • <Bold>Right to rectification (Article 16)</Bold> — correct inaccurate data in Profile
            &gt; Edit Profile, or contact us.{'\n\n'}
            • <Bold>Right to erasure (Article 17)</Bold> — delete your account in Profile &gt;
            Delete account. This is actioned <Bold>immediately</Bold> and irreversibly. Here is
            exactly what happens:{'\n'}
            — Your profile, location consent records, facility votes, push notification token,
            children's age data, and all reviews you have written are permanently deleted.{'\n'}
            — Venue submissions you have made are anonymised — your name and account link are
            removed, but the venue listing remains for community benefit.{'\n'}
            — Photos you uploaded that are pending moderation are deleted in full (image file and
            record).{'\n'}
            — Photos already approved and visible in the app are anonymised: the link to you is
            permanently removed, leaving only an anonymous image of the venue.{'\n'}
            You can also request erasure by emailing privacy@playplanner.app — we will complete
            it within 30 days.{'\n\n'}
            • <Bold>Right to withdraw consent (Article 7(3)</Bold> — withdraw location consent or
            marketing consent at any time in Profile &gt; Privacy Settings. Withdrawal does not
            affect the lawfulness of processing before withdrawal.{'\n\n'}
            • <Bold>Right to restriction (Article 18)</Bold> — ask us to stop processing your data
            while a dispute is being resolved.{'\n\n'}
            • <Bold>Right to data portability (Article 20)</Bold> — receive your data in a
            machine-readable format. Use the "Download my data" feature, which exports JSON.{'\n\n'}
            • <Bold>Right to object (Article 21)</Bold> — object to processing based on legitimate
            interests.{'\n\n'}
            We aim to respond to rights requests without undue delay and within one month of
            receipt. For complex or numerous requests, this may be extended by up to two further
            months; if that applies, we will tell you within the first month and explain why.{'\n\n'}
            • <Bold>Complaining to us directly</Bold> — if you're unhappy with how we've handled
            your data, email privacy@playplanner.app with the subject line "Data Protection
            Complaint." We will acknowledge your complaint within 30 days, investigate it
            appropriately, keep you informed of progress where appropriate, and communicate the
            outcome without undue delay. This 30-day figure is our acknowledgement commitment, not a
            promise to fully resolve every complaint within that time — a complex complaint may
            legitimately take longer to investigate properly.{'\n\n'}
            • <Bold>Right to complain to the ICO</Bold> — you can complain to the Information
            Commissioner's Office at any time, instead of or alongside contacting us directly:
            ico.org.uk or 0303 123 1113. We would appreciate the chance to address your concerns
            first, but this is your choice, not a requirement.
          </Section>

          <Section title="10. Cookies and local storage">
            The PlayPlanner app does not use tracking cookies.{'\n\n'}
            We store authentication/session tokens securely on your device (using iOS Keychain /
            Android Keystore via expo-secure-store) so you can remain signed in between sessions.
            These tokens contain authentication and account-identifying information and are
            protected using the device's secure storage. They are removed from your device when you
            sign out.
          </Section>

          <Section title="11. Security">
            We take reasonable technical and organisational measures to protect your data, including:{'\n\n'}
            • Passwords hashed using bcrypt (handled by Supabase Auth).{'\n'}
            • Session tokens stored in device secure storage (not browser cookies or AsyncStorage).{'\n'}
            • Row-level security on all database tables — users can only access their own data.{'\n'}
            • All data transmitted over HTTPS/TLS.{'\n'}
            • Photo uploads stripped of EXIF metadata (including GPS tags) before storage.{'\n\n'}
            No system is 100% secure. If you discover a security vulnerability, please contact
            privacy@playplanner.app responsibly and we will act promptly.
          </Section>

          <Section title="12. Changes to this policy">
            We will notify you of significant changes by in-app notification or email before the
            changes take effect. The current version is always available in the app. Continued use of
            PlayPlanner after the effective date of changes constitutes acceptance of the updated
            policy.
          </Section>

          <Section title="13. Contact us">
            Data controller: Liam Evanson trading as PlayPlanner{'\n'}
            Email: privacy@playplanner.app{'\n\n'}
            For urgent data protection concerns or to exercise your rights, email us with the subject
            line "Data Rights Request" and we will respond without undue delay and within one month.
            For data-protection complaints, see section 9 — the acknowledgement timing is different
            from the rights-request timing.{'\n\n'}
            This Privacy Policy is also available at:{'\n'}
            lennons-space.github.io/playplanner/privacy.html
          </Section>

          <Section title="14. How to delete your account">
            You can delete your account at any time from{' '}
            <Bold>Settings → Account → Delete Account</Bold> in the app. Deletion is immediate
            and irreversible — see section 9 above for a full breakdown of what is deleted and
            what is anonymised.{'\n\n'}
            If you are unable to access the app, you can request account deletion by emailing
            privacy@playplanner.app with the subject line "Account Deletion Request". We will
            complete the deletion within 30 days.
          </Section>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { tokens: T } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: T.label }]}>{title}</Text>
      <Text style={[styles.sectionBody, { color: T.label2 }]}>{children}</Text>
    </View>
  );
}

function Bold({ children }: { children: string }) {
  const { tokens: T } = useAppTheme();
  return (
    <Text style={[styles.bold, { color: T.label }]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  lastUpdated: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 16,
    marginBottom: 8,
  },
  sectionBody: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 22,
  },
  bold: {
    fontFamily: FontFamily.bodyStrong,
  },
  bottomSpacer: {
    height: 32,
  },
});
