/**
 * Terms of Service screen.
 * Displayed at registration and accessible from Profile > Settings.
 *
 * Governing law: England and Wales.
 * Last reviewed: April 2026
 */
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
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
        <Text className="text-lg font-bold text-charcoal ml-4">Terms of Service</Text>
      </View>

      <ScrollView className="px-6 py-4" showsVerticalScrollIndicator={false}>
        <Text className="text-xs text-grey mb-6">Last updated: April 2026</Text>

        <Section title="1. About PlayPlanner">
          PlayPlanner ("we", "us", "our") is a family venue discovery app published by Liam Evanson
          trading as PlayPlanner, based in the United Kingdom.{'\n\n'}
          By creating an account or using PlayPlanner, you agree to be bound by these Terms of
          Service ("Terms"). If you do not agree, please do not use the app.{'\n\n'}
          These Terms are governed by the laws of England and Wales. Any dispute will be subject to
          the exclusive jurisdiction of the courts of England and Wales.
        </Section>

        <Section title="2. Who can use PlayPlanner">
          You must be <Bold>18 years of age or older</Bold> to create a PlayPlanner account.
          PlayPlanner is designed for parents, carers, and adults who organise activities for
          children.{'\n\n'}
          By registering, you confirm that you are at least 18 years old. If we discover that an
          account belongs to someone under 18, we will close it immediately.{'\n\n'}
          You must be a resident of the United Kingdom to use PlayPlanner at launch. We will
          announce when we expand to other regions.
        </Section>

        <Section title="3. Your account">
          <Bold>Registration</Bold>
          {'\n'}You must provide accurate, current, and complete information when registering. You
          are responsible for keeping your account information up to date.{'\n\n'}
          <Bold>Security</Bold>
          {'\n'}You are responsible for keeping your login credentials confidential. Do not share
          your password with anyone. Notify us immediately at legal@playplanner.app if you suspect
          your account has been compromised.{'\n\n'}
          <Bold>One account per person</Bold>
          {'\n'}You may only hold one personal account. Creating multiple accounts to circumvent
          moderation decisions or to manipulate review ratings is strictly prohibited.{'\n\n'}
          <Bold>Account suspension</Bold>
          {'\n'}We reserve the right to suspend or permanently close accounts that violate these
          Terms, post fraudulent content, or are used to harm other users or venues.
        </Section>

        <Section title="4. Acceptable use">
          You agree to use PlayPlanner only for lawful purposes and in a manner that does not
          infringe the rights of others or restrict their use of the app.{'\n\n'}
          You must <Bold>not</Bold>:{'\n\n'}
          • Submit false, misleading, or fabricated venue reviews or information.{'\n'}
          • Post reviews for venues you own, manage, or have a commercial interest in.{'\n'}
          • Upload photos that contain identifiable images of people, especially children.{'\n'}
          • Harass, threaten, defame, or abuse other users or venue owners.{'\n'}
          • Upload content that is offensive, discriminatory, illegal, or harmful.{'\n'}
          • Impersonate another person, business, or organisation.{'\n'}
          • Attempt to gain unauthorised access to other users' accounts or our systems.{'\n'}
          • Use automated tools, bots, or scripts to scrape, copy, or interact with the app.{'\n'}
          • Interfere with or disrupt the app's infrastructure, servers, or networks.{'\n'}
          • Use the app to promote products or services without our prior written consent.{'\n\n'}
          Violation of these rules may result in immediate account suspension and, where
          appropriate, reporting to law enforcement.
        </Section>

        <Section title="5. Reviews and user-generated content">
          <Bold>Your licence to us</Bold>
          {'\n'}When you submit a review, photo, or venue, you grant PlayPlanner a non-exclusive,
          royalty-free, worldwide licence to display, reproduce, and distribute that content within
          the app and in promotional materials for PlayPlanner. You retain ownership of your
          content.{'\n\n'}
          <Bold>Your responsibility</Bold>
          {'\n'}You are solely responsible for the content you submit. By submitting content you
          confirm that:{'\n'}
          • It is accurate and based on your genuine experience.{'\n'}
          • You have the right to share it (e.g. you took the photo yourself).{'\n'}
          • It does not contain personal data of others without their consent.{'\n'}
          • It does not infringe any third-party intellectual property rights.{'\n\n'}
          <Bold>Moderation</Bold>
          {'\n'}All reviews and photos are reviewed by our team before going live. We reserve the
          right to reject or remove any content that violates these Terms or our community
          guidelines, without notice.{'\n\n'}
          <Bold>Review integrity</Bold>
          {'\n'}PlayPlanner takes fake reviews seriously. In accordance with the Consumer Protection
          from Unfair Trading Regulations 2008, we prohibit fake endorsements. Accounts found
          submitting fake reviews will be permanently banned.
        </Section>

        <Section title="6. Venue submissions">
          Anyone with an account may submit a venue for consideration. All submissions are moderated
          before publication. By submitting a venue you confirm the information is accurate to the
          best of your knowledge.{'\n\n'}
          We reserve the right to edit, decline, or remove venue listings at our discretion,
          including for inaccuracy, safety concerns, or legal reasons.
        </Section>

        <Section title="7. Business accounts and Premium">
          <Bold>Claiming a listing</Bold>
          {'\n'}If you are the verified owner or operator of a venue, you may claim the listing
          through the "Claim this listing" feature. Claiming requires identity verification.
          Falsely claiming a venue you do not own or operate is a breach of these Terms.{'\n\n'}
          <Bold>Premium subscription</Bold>
          {'\n'}A paid Premium subscription is available for business owners. Premium benefits
          include enhanced listing features. Subscription fees are billed in advance and are
          non-refundable except as required by UK consumer law (Consumer Rights Act 2015).{'\n\n'}
          Payments are processed by Stripe. PlayPlanner does not store or process card details.
          You can cancel your subscription at any time from your account settings; you will
          retain Premium access until the end of the billing period.
        </Section>

        <Section title="8. Intellectual property">
          All intellectual property in the PlayPlanner app — including the name, logo, design,
          software code, and curated content — belongs to Liam Evanson trading as PlayPlanner or
          its licensors.{'\n\n'}
          You may not copy, reproduce, modify, distribute, or create derivative works from any
          part of the app without our prior written consent.
        </Section>

        <Section title="9. Venue information and safety">
          PlayPlanner provides venue information for reference only. We do not endorse, inspect,
          or guarantee the safety, quality, accessibility, or suitability of any venue listed.{'\n\n'}
          <Bold>Always verify directly with the venue</Bold> before visiting, particularly
          regarding:{'\n'}
          • Opening hours and pricing (these change frequently).{'\n'}
          • Age restrictions and supervision requirements.{'\n'}
          • Safety facilities and accessibility for your family's specific needs.{'\n\n'}
          We accept no liability for loss, injury, or disappointment arising from reliance on
          venue information in the app.
        </Section>

        <Section title="10. Your privacy">
          We process your personal data in accordance with our Privacy Policy and UK GDPR.
          Our Privacy Policy forms part of these Terms. You can view it at any time in the app
          or at the link shown during registration.{'\n\n'}
          You have the right to access, correct, and delete your data at any time. See our
          Privacy Policy or contact privacy@playplanner.app for details.
        </Section>

        <Section title="11. Limitation of liability">
          To the extent permitted by law:{'\n\n'}
          • PlayPlanner is provided "as is". We make no warranties about its availability,
          accuracy, or fitness for any particular purpose.{'\n\n'}
          • We are not liable for any indirect, incidental, or consequential loss arising from
          your use of the app, including loss of data, loss of revenue, or personal injury.{'\n\n'}
          • Our total liability to you for any claim arising from these Terms or the app will
          not exceed the amount you paid us in the 12 months before the claim arose.{'\n\n'}
          Nothing in these Terms excludes or limits our liability for death or personal injury
          caused by our negligence, fraud, or any liability that cannot be excluded under
          English law, including rights under the Consumer Rights Act 2015.
        </Section>

        <Section title="12. Termination">
          You may delete your account at any time in Profile &gt; Delete account. Deletion is
          permanent and removes your personal data within 30 days.{'\n\n'}
          We may suspend or terminate your access immediately if you breach these Terms, engage
          in fraudulent activity, or if we are required to do so by law. We will give you notice
          where reasonably practicable, unless doing so would compromise security or an
          investigation.
        </Section>

        <Section title="13. Changes to these Terms">
          We may update these Terms from time to time. We will notify you of material changes by
          in-app notification or email at least 14 days before the changes take effect.{'\n\n'}
          Continued use of PlayPlanner after the effective date of changes means you accept the
          updated Terms. If you do not agree, you may delete your account before the effective
          date.
        </Section>

        <Section title="14. Contact us">
          PlayPlanner is operated by Liam Evanson trading as PlayPlanner.{'\n\n'}
          All enquiries — general, legal, and privacy:{'\n'}
          privacy@playplanner.app{'\n\n'}
          Our full Privacy Policy is available at:{'\n'}
          playplanner.app/privacy
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
