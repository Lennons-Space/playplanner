/**
 * Terms of Service screen
 * UK GDPR Article 13 — users must be able to read the Terms before accepting.
 * TODO: Replace placeholder text below with your actual Terms of Service
 *       (drafted and reviewed by a solicitor before going live).
 */
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4 border-b border-greyLighter">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal ml-4">Terms of Service</Text>
      </View>

      <ScrollView className="px-6 py-4" showsVerticalScrollIndicator={false}>
        <Text className="text-xs text-grey mb-6">Last updated: April 2026</Text>

        <Section title="1. About PlayPlanner">
          PlayPlanner is a family discovery app that helps parents find child-friendly venues in the
          UK. By creating an account you agree to these Terms of Service ("Terms"). Please read them
          carefully before registering.
        </Section>

        <Section title="2. Who can use PlayPlanner">
          You must be 18 or older to create an account. PlayPlanner is designed for parents and
          carers. If you are under 18, please ask a parent or guardian to register on your behalf.
        </Section>

        <Section title="3. Your account">
          You are responsible for keeping your login credentials secure. Do not share your password.
          You must provide accurate information when registering. We may suspend accounts that we
          believe are fake or being misused.
        </Section>

        <Section title="4. Acceptable use">
          When using PlayPlanner you must not:{'\n\n'}
          • Submit false, misleading, or fraudulent venue reviews.{'\n'}
          • Harass, threaten, or abuse other users.{'\n'}
          • Upload illegal, offensive, or harmful content.{'\n'}
          • Attempt to access other users' data or accounts.{'\n'}
          • Use automated tools to scrape or copy our data.
        </Section>

        <Section title="5. Venue submissions and reviews">
          When you submit a venue or write a review, you grant PlayPlanner a non-exclusive licence
          to display that content in the app. All submissions are moderated before going live. We
          reserve the right to reject or remove content that violates these Terms.
        </Section>

        <Section title="6. Your data">
          We process your personal data in accordance with our Privacy Policy and UK GDPR. You have
          the right to access, correct, and delete your data at any time. See our Privacy Policy for
          full details.
        </Section>

        <Section title="7. Limitation of liability">
          PlayPlanner provides venue information for reference only. We do not guarantee the
          accuracy, safety, or suitability of any venue listed. Always check venues directly before
          visiting, especially regarding safety for children.
        </Section>

        <Section title="8. Changes to these Terms">
          We may update these Terms from time to time. We will notify you of significant changes by
          email or in-app notification. Continued use of PlayPlanner after changes means you accept
          the updated Terms.
        </Section>

        <Section title="9. Contact us">
          If you have questions about these Terms, contact us at:{'\n'}
          legal@playplanner.app
        </Section>

        <Text className="text-xs text-grey mt-8 mb-4">
          ⚠️ These Terms are a placeholder. Before launching, have them reviewed by a solicitor
          qualified in UK consumer and data protection law.
        </Text>
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
