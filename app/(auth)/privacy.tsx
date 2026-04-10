/**
 * Privacy Policy screen
 * UK GDPR Article 13 — mandatory transparency notice at point of data collection.
 * TODO: Replace placeholder text below with your actual Privacy Policy
 *       (drafted and reviewed by a solicitor/DPO before going live).
 */
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4 border-b border-greyLighter">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal ml-4">Privacy Policy</Text>
      </View>

      <ScrollView className="px-6 py-4" showsVerticalScrollIndicator={false}>
        <Text className="text-xs text-grey mb-6">Last updated: April 2026</Text>

        <Section title="Who we are">
          PlayPlanner ("we", "us") is a family discovery app based in the UK. We are the data
          controller for the personal data you provide when using the app. Contact us at:
          privacy@playplanner.app
        </Section>

        <Section title="What data we collect">
          • Your name and email address (required to create an account).{'\n'}
          • Your location — only when you actively use the map, and only with your permission.{'\n'}
          • Venue reviews and photos you choose to submit.{'\n'}
          • Children's age ranges (optional — used to filter venues by age suitability).{'\n'}
          • Marketing preferences (optional — you can change these at any time).{'\n'}
          • Device information for app performance and security.
        </Section>

        <Section title="Why we collect it (lawful basis)">
          • Account and app features: contract (UK GDPR Article 6(1)(b)).{'\n'}
          • Location processing: explicit consent (UK GDPR Article 6(1)(a)).{'\n'}
          • Marketing emails: explicit consent (UK GDPR Article 6(1)(a) + PECR).{'\n'}
          • Safety, fraud prevention, legal compliance: legitimate interests / legal obligation.
        </Section>

        <Section title="Location data">
          We only access your location when you are actively using the map feature, and only after
          you grant permission. Location is used to show nearby venues — it is never stored
          permanently, shared with third parties, or used for advertising. You can revoke location
          permission in your device settings at any time.
        </Section>

        <Section title="Children's data">
          PlayPlanner is for parents and carers aged 18+. We apply heightened protections per the
          ICO Age-Appropriate Design Code (Children's Code). Children's age ranges (if provided) are
          used only to filter venue results and are never shared externally.
        </Section>

        <Section title="Who we share data with">
          • Supabase (our database provider) — processes data on our behalf under a data processing
          agreement.{'\n'}
          • Stripe (payments) — if you purchase a premium subscription.{'\n'}
          • Google Maps API — anonymised location queries for the map.{'\n'}
          We do not sell your data. We do not share it with advertisers.
        </Section>

        <Section title="How long we keep your data">
          Your account data is kept for as long as your account is active. If you delete your
          account, we delete your personal data within 30 days (except where we are required to
          retain it by law). Location data is not stored after your session ends.
        </Section>

        <Section title="Your rights">
          Under UK GDPR you have the right to:{'\n\n'}
          • Access your data (Subject Access Request).{'\n'}
          • Correct inaccurate data.{'\n'}
          • Delete your data ("right to be forgotten").{'\n'}
          • Withdraw consent at any time (this does not affect past processing).{'\n'}
          • Object to processing based on legitimate interests.{'\n'}
          • Complain to the ICO at ico.org.uk if you believe we have mishandled your data.{'\n\n'}
          To exercise any of these rights, contact: privacy@playplanner.app
        </Section>

        <Section title="Cookies and tracking">
          The app does not use tracking cookies. We use Supabase session tokens (stored securely on
          your device) solely to keep you logged in.
        </Section>

        <Section title="Changes to this policy">
          We will notify you of significant changes by email or in-app notification. The latest
          version is always available in the app.
        </Section>

        <Text className="text-xs text-grey mt-8 mb-4">
          ⚠️ This Privacy Policy is a placeholder. Before launching, have it reviewed by a
          solicitor or DPO qualified in UK GDPR and ICO Children's Code compliance.
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
