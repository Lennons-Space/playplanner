import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Themes } from '@/constants/theme';

export const ONBOARDING_KEY = 'onboarding_complete';

export default function AuthIndex() {
  const [checked, setChecked] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY)
      .then((val) => { setSeen(val === '1'); setChecked(true); })
      .catch(() => setChecked(true));
  }, []);

  // Pre-check flash — v2 dark floor (not Colors.slate, the legacy light bg)
  // so there is no light flash before the redirect resolves.
  if (!checked) return <View style={{ flex: 1, backgroundColor: Themes.dark.bg }} />;
  if (seen) return <Redirect href="/(auth)/welcome" />;
  return <Redirect href="/(auth)/onboarding-1" />;
}
