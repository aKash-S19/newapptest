/**
 * lib/notifications.ts
 * Local push notifications for incoming messages.
 *
 * expo-notifications remote push was removed from Expo Go in SDK 53.
 * We mock the entire module in Expo Go to prevent any errors.
 * In a development build or production build everything works normally.
 */
import { Platform } from 'react-native';

const CALL_CATEGORY_ID = 'incoming_call';
const CALL_ACTION_ACCEPT = 'CALL_ACCEPT';
const CALL_ACTION_DECLINE = 'CALL_DECLINE';

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
    setNotificationCategoryAsync: async () => {},
    getPermissionsAsync: async () => ({ status: 'denied' }),
    requestPermissionsAsync: async () => ({ status: 'denied' }),
    getExpoPushTokenAsync: async () => ({ data: '' }),
    setNotificationChannelAsync: async () => {},
    AndroidImportance: { MAX: 5 },
    AndroidAudioUsage: { NOTIFICATION_RINGTONE: 6, NOTIFICATION: 5 },
    AndroidAudioContentType: { SONIFICATION: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    scheduleNotificationAsync: async () => '',
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationsDidReceiveNotificationListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getLastNotificationResponseAsync: async () => null,
    clearLastNotificationResponseAsync: async () => {},
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

let runtimeConfigured = false;

function getCallChannelConfig(mod: any) {
  return {
    name: 'calls',
    importance: mod.AndroidImportance?.MAX ?? 5,
    sound: 'default',
    vibrationPattern: [0, 500, 300, 500],
    lockscreenVisibility: mod.AndroidNotificationVisibility?.PUBLIC,
    bypassDnd: true,
    audioAttributes: {
      usage: mod.AndroidAudioUsage?.NOTIFICATION_RINGTONE ?? mod.AndroidAudioUsage?.NOTIFICATION ?? 5,
      contentType: mod.AndroidAudioContentType?.SONIFICATION ?? 4,
      flags: {
        enforceAudibility: true,
        requestHardwareAudioVideoSynchronization: false,
      },
    },
  };
}

function normalizeNotificationData(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const type = String(raw.type ?? '').trim();
  if (type !== 'message' && type !== 'group_message' && type !== 'call_offer') return null;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

export async function configureNotificationRuntime(): Promise<void> {
  if (Platform.OS === 'web' || runtimeConfigured) return;
  const mod = await getNotifications();
  if (!mod?.setNotificationHandler) return;

  mod.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  try {
    await mod.setNotificationCategoryAsync?.(
      CALL_CATEGORY_ID,
      [
        {
          identifier: CALL_ACTION_ACCEPT,
          buttonTitle: 'Accept',
          options: { opensAppToForeground: true },
        },
        {
          identifier: CALL_ACTION_DECLINE,
          buttonTitle: 'Decline',
          options: { opensAppToForeground: true, isDestructive: true },
        },
      ],
      {
        showTitle: true,
        showSubtitle: true,
      },
    );
  } catch {
    // Category actions are best-effort only.
  }

  runtimeConfigured = true;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const mod = await getNotifications();
  try {
    const { status: existing } = await mod.getPermissionsAsync();
    if (existing === 'granted') {
      if (Platform.OS === 'android') {
        await mod.setNotificationChannelAsync?.('default', {
          name: 'default',
          importance: mod.AndroidImportance?.MAX ?? 5,
          vibrationPattern: [0, 250, 250, 250],
        });
        await mod.setNotificationChannelAsync?.('calls', getCallChannelConfig(mod));
      }
      return true;
    }
    const { status } = await mod.requestPermissionsAsync();
    if (status === 'granted' && Platform.OS === 'android') {
      await mod.setNotificationChannelAsync?.('default', {
        name: 'default',
        importance: mod.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 250, 250],
      });
      await mod.setNotificationChannelAsync?.('calls', getCallChannelConfig(mod));
    }
    return status === 'granted';
  } catch {
    return false;
  }
}

let cachedExpoPushToken: string | null = null;

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (checkIsExpoGo()) return null;
  if (cachedExpoPushToken) return cachedExpoPushToken;

  const mod = await getNotifications();
  try {
    const Constants = require('expo-constants');
    const projectId =
      Constants?.default?.expoConfig?.extra?.eas?.projectId ||
      Constants?.default?.easConfig?.projectId ||
      '';
    if (!projectId) return null;

    const tokenResult = await mod.getExpoPushTokenAsync({ projectId });
    const token = String(tokenResult?.data ?? '').trim();
    if (!token) return null;

    cachedExpoPushToken = token;
    return token;
  } catch {
    return null;
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
  unreadCount?: number;
  sentAt?: string;
  sound?: 'default' | 'silent';
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const mod = await getNotifications();
  try {
    const sound = opts.sound === 'silent' ? null : 'default';
    const unreadCount = Math.max(1, Number(opts.unreadCount ?? 1));
    const subtitle = opts.groupId ? (opts.groupName ?? opts.senderName) : opts.senderName;
    const threadId = opts.groupId ? `group:${opts.groupId}` : `chat:${opts.chatId}`;
    const body = unreadCount > 1 ? `${opts.preview} (${unreadCount} unread)` : opts.preview;

    await mod.scheduleNotificationAsync({
      content: {
        title: 'Privy',
        subtitle,
        body,
        sound,
        badge: unreadCount,
        priority: 'high',
        channelId: 'default',
        threadIdentifier: threadId,
        data: {
          type: opts.groupId ? 'group_message' : 'message',
          chatId: opts.chatId,
          peerId: opts.peerId,
          peerName: opts.peerName,
          peerAvatar: opts.peerAvatar ?? '',
          peerKey: opts.peerKey ?? '',
          groupId: opts.groupId ?? '',
          groupName: opts.groupName ?? '',
          unreadCount: String(unreadCount),
          sentAt: opts.sentAt ?? '',
        },
      },
      trigger: null,
    });
  } catch {}
}

export async function showIncomingCallNotification(opts: {
  chatId: string;
  callId: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const mod = await getNotifications();
  try {
    await mod.scheduleNotificationAsync({
      content: {
        title: 'Privy',
        subtitle: opts.peerName,
        body: 'Incoming voice call',
        sound: 'default',
        priority: 'max',
        channelId: 'calls',
        threadIdentifier: `call:${opts.chatId}`,
        autoDismiss: false,
        sticky: true,
        categoryIdentifier: CALL_CATEGORY_ID,
        interruptionLevel: 'timeSensitive',
        data: {
          type: 'call_offer',
          chatId: opts.chatId,
          callId: opts.callId,
          peerId: opts.peerId,
          peerName: opts.peerName,
          peerAvatar: opts.peerAvatar ?? '',
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
      const data = normalizeNotificationData(response?.notification?.request?.content?.data);
      if (!data) return;

      const notificationId = String(response?.notification?.request?.identifier ?? '').trim();
      if (notificationId) data.notificationId = notificationId;

      const actionIdentifier = String(response?.actionIdentifier ?? '').trim();
      if (actionIdentifier) data.actionIdentifier = actionIdentifier;

      handler(data);
    });
  } catch {
    return { remove: () => {} };
  }
}

export async function getLastNotificationResponseData(): Promise<Record<string, string> | null> {
  if (Platform.OS === 'web') return null;
  const mod = await getNotifications();
  try {
    const response = await mod.getLastNotificationResponseAsync?.();
    const data = normalizeNotificationData(response?.notification?.request?.content?.data);
    if (!data) return null;

    const notificationId = String(response?.notification?.request?.identifier ?? '').trim();
    if (notificationId) data.notificationId = notificationId;

    const actionIdentifier = String(response?.actionIdentifier ?? '').trim();
    if (actionIdentifier) data.actionIdentifier = actionIdentifier;

    await mod.clearLastNotificationResponseAsync?.();
    return data;
  } catch {
    return null;
  }
}