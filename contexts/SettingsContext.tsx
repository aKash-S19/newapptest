import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
  biometricLock:    boolean;
  whoCanMessage:    'everyone' | 'friends' | 'nobody';
  // Notifications
  msgNotifs:        boolean;
  muteGroups:       boolean;
  dnd:              boolean;
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
  biometricLock:    false,
  whoCanMessage:    'everyone',
  msgNotifs:        true,
  muteGroups:       false,
  dnd:              false,
};

const STORAGE_KEY = 'privy_app_settings';

// ─── Context ─────────────────────────────────────────────────────────────────
interface SettingsContextType {
  settings: AppSettings;
  isLoaded: boolean;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULTS,
  isLoaded: false,
  update: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored) setSettings({ ...DEFAULTS, ...JSON.parse(stored) });
      } catch {}
      finally { setIsLoaded(true); }
    })();
  }, []);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, isLoaded, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() { return useContext(SettingsContext); }
