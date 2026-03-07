// Import expo-crypto first so its WebCrypto polyfill is set up before any e2ee calls.
import {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    useFonts,
} from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { addNotificationResponseListener, requestNotificationPermission } from '@/lib/notifications';
import { ONBOARDING_KEY } from './onboarding';

// Keep the splash screen up while fonts load
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: 'onboarding',
};

// Custom nav themes — override background/card so the navigator canvas
// never flashes the default white between screens.
const LightNavTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#F4F6F8', card: '#FFFFFF' },
};
const DarkNavTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#111827', card: '#1F2937' },
};

// Inner shell — can safely consume SettingsContext since it renders inside SettingsProvider
function AppShell() {
  const { settings, isLoaded } = useSettings();
  const dk = settings.darkMode;
  const bg = dk ? '#111827' : '#F4F6F8';

  // Paint the native window/root-view background immediately so there is
  // never a white frame visible during any JS-driven navigation transition.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg);
  }, [bg]);

  // Block rendering until SecureStore resolves so we never flash the wrong theme
  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: bg }} />
    );
  }

  return (
    <ThemeProvider value={dk ? DarkNavTheme : LightNavTheme}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: bg },
          animation: 'fade',
          // Keep the screen behind alive — prevents the re-attach white flash on pop
          detachPreviousScreen: false,
        }}
      >
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="auth"     options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"   options={{ headerShown: false }} />
        <Stack.Screen
          name="requests"
          options={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: bg },
            detachPreviousScreen: false,
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            headerShown: false,
            presentation: 'card',
            animation: 'fade',
            contentStyle: { backgroundColor: bg },
            detachPreviousScreen: false,
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: bg },
            detachPreviousScreen: false,
          }}
        />
      </Stack>
      <StatusBar style={dk ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const router = useRouter();

  useEffect(() => {
    if (!fontsLoaded) return;
    SplashScreen.hideAsync();
    // Redirect returning users past onboarding
    SecureStore.getItemAsync(ONBOARDING_KEY).then((val) => {
      if (val === '1') router.replace('/auth');
      // else stay on onboarding (default initial route)
    });
  }, [fontsLoaded]);

  // Ask for push permission once on first launch and wire up tap-to-open-chat
  useEffect(() => {
    requestNotificationPermission();
    const sub = addNotificationResponseListener((data) => {
      if (data.chatId) {
        router.push({
          pathname: '/chat/[id]' as any,
          params: {
            id:          data.chatId,
            peerId:      data.peerId,
            peerName:    data.peerName,
            peerAvatar:  data.peerAvatar ?? '',
            peerKey:     data.peerKey    ?? '',
          },
        });
      }
    });
    return () => sub.remove();
  }, []);

  // Don’t render until fonts are ready — prevents FOUT
  if (!fontsLoaded) return null;

  return (
    <SettingsProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </SettingsProvider>
  );
}

