/**
 * PlayPlanner Pass — interest registration screen.
 *
 * Lets users register their email to be notified when the Pass
 * subscription launches. On submit, inserts a row into pass_interest.
 *
 * GDPR note: we collect only the email address and source tag.
 * The inline GDPR statement below the CTA is the lawful basis disclosure
 * (legitimate interest / pre-contractual communication). No marketing
 * consent checkbox is needed because we send exactly one transactional
 * notification email at launch — not a marketing series.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/theme';

// Simple RFC-5321-style email validation — good enough for a pre-launch form.
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function PassInterestScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    const { error: dbError } = await supabase
      .from('pass_interest')
      .upsert(
        { email: email.trim().toLowerCase(), source: 'profile_menu' },
        { onConflict: 'email', ignoreDuplicates: true }
      );
    setLoading(false);

    if (dbError) {
      // Only log safe metadata — never the email address.
      console.error('pass_interest insert error:', dbError.code, dbError.hint);
      setError('Something went wrong. Please try again.');
      return;
    }

    setSuccess(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.slate }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Hero gradient ─────────────────────────────────────────────── */}
          <LinearGradient
            colors={['#4ECDC4', '#3AB5AC']}
            style={{ paddingTop: 56, paddingBottom: 48, paddingHorizontal: 24, alignItems: 'center' }}
          >
            {/* Back button */}
            <TouchableOpacity
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.25)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>

            {/* Diamond icon */}
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
              }}
            >
              <Ionicons name="diamond" size={36} color="#fff" />
            </View>

            <Text
              style={{
                fontFamily: 'Nunito-ExtraBold',
                fontSize: 30,
                color: '#fff',
                textAlign: 'center',
                lineHeight: 36,
              }}
            >
              More of the good days.
            </Text>
            <Text
              style={{
                fontFamily: 'Nunito-Regular',
                fontSize: 16,
                color: 'rgba(255,255,255,0.88)',
                textAlign: 'center',
                marginTop: 10,
                lineHeight: 24,
                paddingHorizontal: 8,
              }}
            >
              PlayPlanner Pass gives you tools to plan better days out, every week.
            </Text>
          </LinearGradient>

          {/* ── Content card ──────────────────────────────────────────────── */}
          <View
            style={{
              marginTop: -20,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: '#fff',
              paddingTop: 28,
              paddingHorizontal: 20,
            }}
          >

            {/* ── Features list ─────────────────────────────────────────── */}
            <Text
              style={{
                fontFamily: 'Nunito-Bold',
                fontSize: 13,
                color: Colors.grey,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              What you get
            </Text>

            {[
              { icon: 'people-outline' as const,       label: 'Personalised picks by your children\'s ages' },
              { icon: 'cloud-download-outline' as const, label: 'Offline venue saving for days without signal' },
              { icon: 'map-outline' as const,          label: 'Day-out itinerary builder' },
            ].map(({ icon, label }) => (
              <View
                key={label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: Colors.sky + '18',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={icon} size={18} color={Colors.sky} />
                </View>
                <Text
                  style={{
                    fontFamily: 'Nunito-Medium',
                    fontSize: 15,
                    color: Colors.charcoal,
                    flex: 1,
                    lineHeight: 22,
                  }}
                >
                  {label}
                </Text>
              </View>
            ))}

            {/* ── Pricing ───────────────────────────────────────────────── */}
            <View style={{ marginTop: 8, marginBottom: 28, gap: 10 }}>

              {/* Annual — highlighted */}
              <View
                style={{
                  borderWidth: 2,
                  borderColor: Colors.sky,
                  borderRadius: 16,
                  padding: 16,
                  backgroundColor: Colors.sky + '0D',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{
                        fontFamily: 'Nunito-ExtraBold',
                        fontSize: 17,
                        color: Colors.charcoal,
                      }}
                    >
                      £19.99 / year
                    </Text>
                    <View
                      style={{
                        backgroundColor: Colors.sky,
                        borderRadius: 999,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: 'Nunito-Bold',
                          fontSize: 11,
                          color: '#fff',
                        }}
                      >
                        Best value
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={{
                      fontFamily: 'Nunito-Regular',
                      fontSize: 13,
                      color: Colors.grey,
                    }}
                  >
                    Just £1.67 / month
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={24} color={Colors.sky} />
              </View>

              {/* Monthly */}
              <View
                style={{
                  borderWidth: 1,
                  borderColor: Colors.greyLighter,
                  borderRadius: 16,
                  padding: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Nunito-Bold',
                    fontSize: 16,
                    color: Colors.charcoal,
                  }}
                >
                  £2.99 / month
                </Text>
                <Text
                  style={{
                    fontFamily: 'Nunito-Regular',
                    fontSize: 13,
                    color: Colors.grey,
                  }}
                >
                  Cancel any time
                </Text>
              </View>
            </View>

            {/* ── Success state ─────────────────────────────────────────── */}
            {success ? (
              <View style={{ alignItems: 'center', paddingVertical: 16, paddingBottom: 32 }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: Colors.sky + '20',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Ionicons name="checkmark-circle" size={36} color={Colors.sky} />
                </View>
                <Text
                  style={{
                    fontFamily: 'Nunito-ExtraBold',
                    fontSize: 20,
                    color: Colors.charcoal,
                    textAlign: 'center',
                    marginBottom: 8,
                  }}
                >
                  You're on the list.
                </Text>
                <Text
                  style={{
                    fontFamily: 'Nunito-Regular',
                    fontSize: 15,
                    color: Colors.grey,
                    textAlign: 'center',
                    lineHeight: 22,
                  }}
                >
                  We'll let you know before it launches.
                </Text>
              </View>
            ) : (
              <>
                {/* ── Email input ───────────────────────────────────────── */}
                <Text
                  style={{
                    fontFamily: 'Nunito-Bold',
                    fontSize: 13,
                    color: Colors.grey,
                    letterSpacing: 0.8,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  Get early access
                </Text>

                <TextInput
                  style={{
                    borderWidth: 1.5,
                    borderColor: error ? Colors.error : Colors.greyLighter,
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    fontFamily: 'Nunito-Regular',
                    fontSize: 15,
                    color: Colors.charcoal,
                    backgroundColor: Colors.slate,
                    marginBottom: error ? 8 : 0,
                  }}
                  placeholder="Your email address"
                  placeholderTextColor={Colors.greyLight}
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(null); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  editable={!loading}
                />

                {error && (
                  <Text
                    style={{
                      fontFamily: 'Nunito-Regular',
                      fontSize: 13,
                      color: Colors.error,
                      marginBottom: 12,
                    }}
                  >
                    {error}
                  </Text>
                )}

                {/* ── CTA button ────────────────────────────────────────── */}
                <TouchableOpacity
                  style={{
                    backgroundColor: Colors.sky,
                    borderRadius: 16,
                    paddingVertical: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: error ? 0 : 16,
                    flexDirection: 'row',
                    gap: 8,
                    opacity: loading ? 0.7 : 1,
                  }}
                  onPress={handleSubmit}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Notify me when PlayPlanner Pass is ready"
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="notifications-outline" size={18} color="#fff" />
                      <Text
                        style={{
                          fontFamily: 'Nunito-Bold',
                          fontSize: 16,
                          color: '#fff',
                        }}
                      >
                        Notify me when it's ready
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* ── GDPR statement ────────────────────────────────────── */}
                <Text
                  style={{
                    fontFamily: 'Nunito-Regular',
                    fontSize: 12,
                    color: Colors.greyLight,
                    textAlign: 'center',
                    marginTop: 12,
                    lineHeight: 18,
                    paddingHorizontal: 8,
                  }}
                >
                  By submitting you agree to receive one email when PlayPlanner Pass launches. Unsubscribe any time.
                </Text>
              </>
            )}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
