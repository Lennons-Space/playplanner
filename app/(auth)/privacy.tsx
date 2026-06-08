/**
 * Privacy Policy screen — UK GDPR Article 13 transparency notice.
 * Displayed at registration and accessible from Profile > Privacy Settings.
 *
 * This policy covers all data processing activities in PlayPlanner v1.0:
 * account data, location consent logging, reviews, photos, and GDPR rights.
 *
 * Data controller: Liam Evanson trading as PlayPlanner
 * Contact: privacy@playplanner.app
 */
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4 border-b border-greyLighter">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text className="text-sky text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal ml-4">Privacy Policy</Text>
      </View>

      <ScrollView className="px-6 py-4" showsVerticalScrollIndicator={false}>
        <Text className="text-xs text-grey mb-6">Last updated: June 2026</Text>

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
          {'\n'}• Device location — only when you grant permission and only while using the map.
          We round coordinates to approximately 100 metres before use. We do not store your precise
          GPS coordinates on our servers.{'\n'}
          • A record that you gave or refused location permission is stored for GDPR accountability
          purposes. This record contains only a timestamp and a consent version number — not your
          coordinates.{'\n\n'}
          <Bold>Content you create</Bold>
          {'\n'}• Venue reviews — including rating, visit date, and any age ranges you add.{'\n'}
          • Venue photos — images you upload of venues (not people). Photos are stripped of EXIF metadata (including any GPS tags) before being stored. See section 8 for what happens to your photos if you delete your account.{'\n'}
          • Venue submissions — information about venues you add to the app. Submissions are held for moderation before publication and are not visible to other users while under review.{'\n\n'}
          <Bold>Venue facility votes</Bold>
          {'\n'}• When you vote on parent-reported venue facilities (e.g. "has baby change", "has
          parking"), your individual vote is stored privately and linked to your account. Only
          the aggregate count is visible publicly — your individual response is never shown to
          other users. Votes are deleted when you delete your account.{'\n\n'}
          <Bold>Push notification tokens</Bold>
          {'\n'}• If you enable push notifications, we store a push notification token provided by
          your device to send you relevant alerts. This token is not shared with third parties.
          You can disable notifications at any time in your device settings. Tokens are deleted
          when you delete your account.{'\n\n'}
          <Bold>Technical data</Bold>
          {'\n'}• Session tokens — stored securely on your device to keep you logged in.{'\n'}
          • GDPR audit log entries — records of consent events (e.g. terms accepted, location
          consent granted) for legal accountability under UK GDPR Article 5(2). These records
          contain only a user ID, action type, and timestamp — never your personal content.
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
          Location data receives additional protection because of its sensitivity.{'\n\n'}
          • Location is <Bold>off by default</Bold>. We never access it without your explicit
          permission.{'\n'}
          • We ask for location permission only when you open the map screen.{'\n'}
          • Coordinates are rounded to approximately 100 metres (3 decimal places) before any
          processing. High-precision GPS coordinates are discarded immediately.{'\n'}
          • Rounded coordinates are used only to query our venue database and return nearby results.
          They are not stored on our servers after the query completes.{'\n'}
          • We store a log entry recording whether you granted or denied location permission, but
          this entry contains <Bold>no coordinates</Bold> — only a timestamp and consent version.
          This log exists solely to meet our ICO accountability obligations.{'\n'}
          • You can revoke location permission at any time in Profile &gt; Privacy Settings, or in
          your device's system settings.
        </Section>

        <Section title="5. Children's data">
          PlayPlanner is designed for parents and carers aged 18 and over. We comply with the ICO
          Age-Appropriate Design Code (Children's Code).{'\n\n'}
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
          We work with the following data processors, each under a data processing agreement:{'\n\n'}
          • <Bold>Supabase Inc.</Bold> (USA, with EU Standard Contractual Clauses) — our database
          and authentication provider. Stores account data, reviews, and photos on our behalf.{'\n\n'}
          • <Bold>Google LLC</Bold> — Google Maps SDK and Places API are used for the map display
          and address lookup. Location queries sent to Google are anonymised (rounded coordinates).
          Google's privacy policy applies to these requests: policies.google.com/privacy{'\n\n'}
          • <Bold>Stripe Inc.</Bold> (if you purchase a Premium subscription) — processes payment
          card data. PlayPlanner never sees or stores your card number. Stripe's privacy policy
          applies: stripe.com/gb/privacy{'\n\n'}
          • <Bold>Expo / EAS</Bold> — used to build and deliver the app to your device. No personal
          data is shared with Expo beyond what is standard for app delivery.{'\n\n'}
          We may share data if required to do so by law, a court order, or a regulatory authority.
          We will tell you if this happens unless legally prohibited from doing so.
        </Section>

        <Section title="7. International data transfers">
          Supabase stores data on servers in the European Union. Where any transfer outside the UK
          or EEA is required, we ensure appropriate safeguards are in place, such as the UK
          International Data Transfer Agreement (IDTA) or EU Standard Contractual Clauses.
        </Section>

        <Section title="8. How long we keep your data">
          • <Bold>Account data</Bold> — kept for as long as your account is active. Deleted within
          30 days of account deletion, except where legal retention obligations apply.{'\n'}
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
          • <Bold>Location consent log entries</Bold> — kept for 3 years for ICO accountability
          purposes, then deleted automatically.{'\n'}
          • <Bold>GDPR audit log entries</Bold> — kept for 3 years then deleted automatically.{'\n'}
          • <Bold>Payment records</Bold> — Stripe retains transaction records in line with their
          legal obligations (typically 7 years for financial records).{'\n\n'}
          You can download all data we hold about you at any time in Profile &gt; Download my data.
          You can delete your account and all associated data in Profile &gt; Delete account.
        </Section>

        <Section title="9. Your rights under UK GDPR">
          You have the following rights. To exercise any of them, contact privacy@playplanner.app
          or use the in-app controls in Profile &gt; Privacy Settings.{'\n\n'}
          • <Bold>Right of access (Article 15)</Bold> — request a copy of all data we hold about
          you. Use the "Download my data" feature in the app for an instant export.{'\n\n'}
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
          it within 30 days (one calendar month).{'\n\n'}
          • <Bold>Right to withdraw consent (Article 7(3)</Bold> — withdraw location consent or
          marketing consent at any time in Profile &gt; Privacy Settings. Withdrawal does not
          affect the lawfulness of processing before withdrawal.{'\n\n'}
          • <Bold>Right to restriction (Article 18)</Bold> — ask us to stop processing your data
          while a dispute is being resolved.{'\n\n'}
          • <Bold>Right to data portability (Article 20)</Bold> — receive your data in a
          machine-readable format. Use the "Download my data" feature, which exports JSON.{'\n\n'}
          • <Bold>Right to object (Article 21)</Bold> — object to processing based on legitimate
          interests.{'\n\n'}
          • <Bold>Right to complain to the ICO</Bold> — if you believe we have mishandled your
          data, you can complain to the Information Commissioner's Office at ico.org.uk or by
          calling 0303 123 1113. We would appreciate the chance to address your concerns first.{'\n\n'}
          We will respond to rights requests within 30 days (one calendar month).
        </Section>

        <Section title="10. Cookies and local storage">
          The PlayPlanner app does not use tracking cookies.{'\n\n'}
          We store a session token on your device (using iOS Keychain / Android Keystore via
          expo-secure-store) solely to keep you logged in between sessions. This token contains no
          personal data and is deleted when you sign out.
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
          line "Data Rights Request" and we will respond within 30 days.{'\n\n'}
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

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-base font-bold text-charcoal mb-2">{title}</Text>
      <Text className="text-grey text-sm leading-6">{children}</Text>
    </View>
  );
}

function Bold({ children }: { children: string }) {
  return (
    <Text className="text-charcoal font-bold">{children}</Text>
  );
}
