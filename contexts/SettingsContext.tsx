import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { callAuthFunction } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AppSettings {
  // Personalization
  accentColor:      string;  // hex color
  darkMode:         boolean;
  bubbleStyle:      'rounded' | 'square';
  fontSize:         'sm' | 'md' | 'lg' | 'xl';
  // Chat Preferences
  readReceipts:     boolean;
  typingIndicator:  boolean;
  disappearDefault: 'off' | '24h' | '7d' | '30d';
  autoDownload:     boolean;
  // Privacy & Security
  biometricLock:       boolean;
  whoCanMessage:       'everyone' | 'friends' | 'nobody';
  whoCanAddToGroup:    'anyone' | 'friends_only' | 'no_one';
  // Notifications
  msgNotifs:        boolean;
  muteGroups:       boolean;
  dnd:              boolean;
  notificationSound: 'default' | 'silent';
  chatCustomizations: Record<string, { color?: string; nickname?: string }>;
}

const DEFAULTS: AppSettings = {
  accentColor:      '#4CAF82',
  darkMode:         false,
  bubbleStyle:      'rounded',
  fontSize:         'md',
  readReceipts:     true,
  typingIndicator:  true,
  disappearDefault: 'off',
  autoDownload:     false,
  biometricLock:       false,
  whoCanMessage:       'everyone',
  whoCanAddToGroup:    'anyone',
  msgNotifs:        true,
  muteGroups:       false,
  dnd:              false,
  notificationSound: 'default',
  chatCustomizations: {},
};

const STORAGE_KEY = 'privy_app_settings';

// ─── Context ─────────────────────────────────────────────────────────────────
interface SettingsContextType {
  settings: AppSettings;
  isLoaded: boolean;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  setAll: (next: AppSettings) => void;
  setSyncToken: (token: string | null) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULTS,
  isLoaded: false,
  update: () => {},
  setAll: () => {},
  setSyncToken: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const syncInitRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored) setSettings({ ...DEFAULTS, ...JSON.parse(stored) });
      } catch {}
      finally { setIsLoaded(true); }
    })();
  }, []);

  const setAll = useCallback((next: AppSettings) => {
    setSettings(next);
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      if (syncToken) {
        callAuthFunction({ action: 'update-settings', sessionToken: syncToken, settings: next }).catch(() => {});
      }
      return next;
    });
  }, [syncToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!syncToken) { syncInitRef.current = false; return; }
    if (syncInitRef.current) return;
    syncInitRef.current = true;
    (async () => {
      try {
        const res = await callAuthFunction({ action: 'get-settings', sessionToken: syncToken });
        const server = res?.settings ?? null;
        if (server) {
          const merged = { ...DEFAULTS, ...settings, ...server } as AppSettings;
          setAll(merged);
          await callAuthFunction({ action: 'update-settings', sessionToken: syncToken, settings: merged });
        } else {
          await callAuthFunction({ action: 'update-settings', sessionToken: syncToken, settings });
        }
      } catch {}
    })();
  }, [isLoaded, syncToken, settings, setAll]);

  return (
    <SettingsContext.Provider value={{ settings, isLoaded, update, setAll, setSyncToken }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() { return useContext(SettingsContext); }
