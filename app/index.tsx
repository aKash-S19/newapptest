/**
 * app/index.tsx
 *
 * Smart entry-point — runs inside the NavigationContainer so router calls
 * are always safe. Checks the onboarding flag and redirects immediately.
 */
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ONBOARDING_KEY } from './onboarding';

export default function Index() {
  const [target, setTarget] = useState<'/auth' | '/onboarding' | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY).then((val) => {
      setTarget(val === '1' ? '/auth' : '/onboarding');
    });
  }, []);

  // Hold blank screen for the ~1 frame SecureStore takes — no flash
  if (!target) return <View style={{ flex: 1 }} />;

  return <Redirect href={target} />;
}
