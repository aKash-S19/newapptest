/**
 * lib/notifications.ts
 * Local push notifications for incoming messages.
 *
 * expo-notifications remote push was removed from Expo Go in SDK 53.
 * We mock the entire module in Expo Go to prevent any errors.
 * In a development build or production build everything works normally.
 */
import { Platform } from 'react-native';

let isExpoGoChecked = false;
let isExpoGoEnv = false;

function checkIsExpoGo(): boolean {
  if (isExpoGoChecked) return isExpoGoEnv;
  try {
    const Constants = require('expo-constants');
    isExpoGoEnv = Constants?.default?.executionEnvironment === 'storeClient';
  } catch {
    isExpoGoEnv = false;
  }
  isExpoGoChecked = true;
  return isExpoGoEnv;
}

let mockNotifications: any = null;

function createMockNotifications() {
  return {
    setNotificationHandler: () => {},
    getPermissionsAsync: async () => ({ status: 'denied' }),
    requestPermissionsAsync: async () => ({ status: 'denied' }),
    scheduleNotificationAsync: async () => '',
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationsDidReceiveNotificationListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    dismissAllNotificationsAsync: async () => {},
    dismissNotificationAsync: async () => {},
    getPresentedNotificationsAsync: async () => [],
  };
}

function getMockNotifications() {
  if (!mockNotifications) {
    mockNotifications = createMockNotifications();
  }
  return mockNotifications;
}

let actualNotifications: any = null;

async function getNotifications(): Promise<any> {
  if (actualNotifications) return actualNotifications;
  if (Platform.OS === 'web') return null;

  if (checkIsExpoGo()) {
    return getMockNotifications();
  }

  try {
    const mod: any = await import('expo-notifications');
    actualNotifications = mod.default ?? mod;
    return actualNotifications;
  } catch {
    return getMockNotifications();
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const mod = await getNotifications();
  try {
    const { status: existing } = await mod.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await mod.requestPermissionsAsync();
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
  groupId?: string;
  groupName?: string;
  sound?: 'default' | 'silent';
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const mod = await getNotifications();
  try {
    const sound = opts.sound === 'silent' ? null : 'default';
    await mod.scheduleNotificationAsync({
      content: {
        title: opts.groupId ? (opts.groupName ?? 'Group') : opts.senderName,
        body: opts.preview,
        sound,
        data: {
          type: opts.groupId ? 'group_message' : 'message',
          chatId: opts.chatId,
          peerId: opts.peerId,
          peerName: opts.peerName,
          peerAvatar: opts.peerAvatar ?? '',
          peerKey: opts.peerKey ?? '',
          groupId: opts.groupId ?? '',
          groupName: opts.groupName ?? '',
        },
      },
      trigger: null,
    });
  } catch {}
}

export async function addNotificationResponseListener(
  handler: (data: Record<string, string>) => void,
): Promise<{ remove: () => void }> {
  if (Platform.OS === 'web') return { remove: () => {} };
  const mod = await getNotifications();
  try {
    return mod.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification?.request?.content?.data as Record<string, string>;
      if (data?.type === 'message' || data?.type === 'group_message') handler(data);
    });
  } catch {
    return { remove: () => {} };
  }
}