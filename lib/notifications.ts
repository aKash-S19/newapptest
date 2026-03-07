/**
 * lib/notifications.ts
 * Local push notifications for incoming messages.
 *
 * expo-notifications remote push was removed from Expo Go in SDK 53.
 * We load the module lazily via require() inside a try-catch so the app
 * keeps working in Expo Go (notifications are simply no-ops there).
 * In a development build or production build everything works normally.
 */
import { Platform } from 'react-native';

// Lazy-load expo-notifications so a throw at module level doesn't crash the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let N: any = null;
try {
  N = require('expo-notifications');
  // Configure foreground presentation once the module is available
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge:  true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Running in Expo Go with SDK 53+ — notifications unavailable, silently skip
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!N || Platform.OS === 'web') return false;
  try {
    const { status: existing } = await N.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await N.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function showMessageNotification(opts: {
  senderName: string;
  preview: string;
  chatId: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  peerKey?: string;
}): Promise<void> {
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: {
        title: opts.senderName,
        body:  opts.preview,
        sound: true,
        data: {
          type:       'message',
          chatId:     opts.chatId,
          peerId:     opts.peerId,
          peerName:   opts.peerName,
          peerAvatar: opts.peerAvatar ?? '',
          peerKey:    opts.peerKey   ?? '',
        },
      },
      trigger: null, // fire immediately
    });
  } catch {
    // Permission not granted or module unavailable — silently ignore
  }
}

/** Returns a subscription object with a `.remove()` method (always safe to call). */
export function addNotificationResponseListener(
  handler: (data: Record<string, string>) => void,
): { remove: () => void } {
  if (!N) return { remove: () => {} };
  try {
    return N.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (data?.type === 'message') handler(data);
    });
  } catch {
    return { remove: () => {} };
  }
}
