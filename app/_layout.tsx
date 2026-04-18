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
import { Stack, usePathname, useRouter } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth, type ChatRow } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { addNotificationResponseListener, requestNotificationPermission, showMessageNotification } from '@/lib/notifications';
import { callAuthFunction } from '@/lib/supabase';

// Keep the splash screen up while fonts load
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: 'index',
};

// Custom nav themes — override background/card so the navigator canvas
// never flashes the default white between screens.
const LightNavTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#F4F6F8', card: '#FFFFFF' },
};
const DarkNavTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0B0D10', card: '#14171C' },
};

interface GroupOverviewRow {
  id: string;
  name: string;
  last_message: {
    text: string;
    created_at: string;
    username: string;
  } | null;
}

function getActiveChatTargets(pathname: string): { chatId: string | null; groupId: string | null } {
  const groupMatch = pathname.match(/^\/chat\/group\/([^/]+)$/);
  if (groupMatch) {
    const id = decodeURIComponent(groupMatch[1]);
    if (!id.startsWith('[')) return { chatId: null, groupId: id };
  }

  const chatMatch = pathname.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) {
    const id = decodeURIComponent(chatMatch[1]);
    if (!id.startsWith('[')) return { chatId: id, groupId: null };
  }

  return { chatId: null, groupId: null };
}

function directPreview(msgType?: string): string {
  if (msgType === 'image') return 'Photo';
  if (msgType === 'file') return 'Document';
  if (msgType === 'voice') return 'Voice message';
  if (msgType === 'video') return 'Video';
  return 'New message';
}

function RealtimeNotificationBridge({ pathname }: { pathname: string }) {
  const { settings } = useSettings();
  const { sessionToken, user, getChats } = useAuth();

  const directStateRef = useRef<Record<string, { lastMessageId: string; unreadCount: number }>>({});
  const groupStateRef = useRef<Record<string, string>>({});
  const seededRef = useRef(false);

  useEffect(() => {
    if (!sessionToken || !user?.id) {
      directStateRef.current = {};
      groupStateRef.current = {};
      seededRef.current = false;
      return;
    }

    let cancelled = false;

    const syncNotifications = async () => {
      try {
        const [chatRows, groups] = await Promise.all([
          getChats().catch(() => [] as ChatRow[]),
          callAuthFunction({ action: 'get-groups-overview', sessionToken })
            .then((res) => (res?.groups ?? []) as GroupOverviewRow[])
            .catch(() => [] as GroupOverviewRow[]),
        ]);

        if (cancelled) return;

        const active = getActiveChatTargets(pathname);
        const allowDirect = settings.msgNotifs && !settings.dnd;
        const allowGroups = allowDirect && !settings.muteGroups;
        const lowerUsername = String(user.username ?? '').toLowerCase();

        const nextDirect: Record<string, { lastMessageId: string; unreadCount: number }> = {};
        for (const chat of chatRows) {
          const messageId = String(chat.last_message?.id ?? '');
          const unreadCount = Number(chat.unread_count ?? 0);
          const prev = directStateRef.current[chat.chat_id];
          const fromPeer = !!chat.last_message?.sender_id && chat.last_message.sender_id !== user.id;
          const unreadIncreased = prev ? unreadCount > prev.unreadCount : false;

          if (
            seededRef.current &&
            allowDirect &&
            fromPeer &&
            unreadIncreased &&
            messageId &&
            active.chatId !== chat.chat_id
          ) {
            const preview = `${chat.user.username}: ${directPreview(chat.last_message?.msg_type)}`;
            void showMessageNotification({
              senderName: chat.user.username,
              preview,
              chatId: chat.chat_id,
              peerId: chat.user.id,
              peerName: chat.user.username,
              peerAvatar: chat.user.avatar_url ?? '',
              peerKey: chat.peer_public_key ?? '',
              sound: settings.notificationSound,
            });
          }

          nextDirect[chat.chat_id] = { lastMessageId: messageId, unreadCount };
        }
        directStateRef.current = nextDirect;

        const nextGroups: Record<string, string> = {};
        for (const group of groups) {
          const stamp = String(group.last_message?.created_at ?? '');
          const prevStamp = groupStateRef.current[group.id] ?? '';
          const sender = String(group.last_message?.username ?? '').toLowerCase();
          const fromOtherMember = !!sender && sender !== lowerUsername;

          if (
            seededRef.current &&
            allowGroups &&
            stamp &&
            stamp !== prevStamp &&
            fromOtherMember &&
            active.groupId !== group.id
          ) {
            const body = `${group.last_message?.username ?? 'Someone'}: ${group.last_message?.text ?? 'Encrypted message'}`;
            void showMessageNotification({
              senderName: group.last_message?.username ?? group.name,
              preview: body,
              chatId: '',
              peerId: '',
              peerName: '',
              groupId: group.id,
              groupName: group.name,
              sound: settings.notificationSound,
            });
          }

          nextGroups[group.id] = stamp;
        }
        groupStateRef.current = nextGroups;

        seededRef.current = true;
      } catch {
        // Keep polling; avoid noisy logs from transient network failures.
      }
    };

    syncNotifications();
    const timer = setInterval(() => {
      syncNotifications();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    sessionToken,
    user?.id,
    user?.username,
    getChats,
    pathname,
    settings.msgNotifs,
    settings.dnd,
    settings.muteGroups,
    settings.notificationSound,
  ]);

  return null;
}

// Inner shell — can safely consume SettingsContext since it renders inside SettingsProvider
function AppShell() {
  const { settings, isLoaded, setSyncToken } = useSettings();
  const { sessionToken } = useAuth();
  const pathname = usePathname();
  const dk = settings.darkMode;
  const bg = dk ? '#0B0D10' : '#F4F6F8';

  // Paint the native window/root-view background immediately so there is
  // never a white frame visible during any JS-driven navigation transition.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg);
  }, [bg]);

  useEffect(() => {
    setSyncToken(sessionToken ?? null);
  }, [sessionToken, setSyncToken]);

  useEffect(() => {
    const canCapture =
      pathname === '/profile' ||
      pathname === '/settings' ||
      pathname.startsWith('/settings/');

    (async () => {
      try {
        if (canCapture) await ScreenCapture.allowScreenCaptureAsync();
        else await ScreenCapture.preventScreenCaptureAsync();
      } catch {
        // Best effort only.
      }
    })();
  }, [pathname]);

  // Block rendering until SecureStore resolves so we never flash the wrong theme
  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: bg }} />
    );
  }

  return (
    <ThemeProvider value={dk ? DarkNavTheme : LightNavTheme}>
      <RealtimeNotificationBridge pathname={pathname} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index"      options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="auth"     options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"   options={{ headerShown: false }} />
        <Stack.Screen
          name="requests"
          options={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: bg },
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            headerShown: false,
            presentation: 'card',
            animation: 'fade',
            contentStyle: { backgroundColor: bg },
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: bg },
          }}
        />
        <Stack.Screen
          name="chat/group/[id]"
          options={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: bg },
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
  }, [fontsLoaded]);

  // Ask for push permission once on first launch and wire up tap-to-open-chat
  useEffect(() => {
    let mounted = true;
    let sub: { remove: () => void } | null = null;

    requestNotificationPermission();
    addNotificationResponseListener((data) => {
      if (data.groupId) {
        router.push({
          pathname: '/chat/group/[id]' as any,
          params: { id: data.groupId },
        });
        return;
      }
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
    }).then((nextSub) => {
      if (!mounted) {
        nextSub.remove();
        return;
      }
      sub = nextSub;
    });

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [router]);

  // Don't render until fonts are ready — prevents FOUT
  if (!fontsLoaded) return null;

  return (
    <SettingsProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </SettingsProvider>
  );
}