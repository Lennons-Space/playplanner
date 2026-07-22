import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAppTheme } from '@/hooks/useAppTheme';

export const ONBOARDING_KEY = 'onboarding_complete';

export default function AuthIndex() {
  const { tokens: T } = useAppTheme();
  const [checked, setChecked] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY)
      .then((val) => { setSeen(val === '1'); setChecked(true); })
      .catch(() => setChecked(true));
  }, []);

  // Pre-check flash — mode-matched floor (not Colors.slate, the legacy
  // light-only bg) so there is no wrong-mode flash before the redirect
  // resolves.
  if (!checked) return <View style={{ flex: 1, backgroundColor: T.bg }} />;
  if (seen) return <Redirect href="/(auth)/welcome" />;
  return <Redirect href="/(auth)/onboarding-1" />;
}
