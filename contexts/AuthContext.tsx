import * as SecureStore from 'expo-secure-store';
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from 'react';

import { getOrCreateDeviceId } from '@/lib/deviceId';
import { callAuthFunction } from '@/lib/supabase';

// ─── Keys ────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'privy_session_token';
const USER_KEY    = 'privy_user_info';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface UserInfo {
  id:         string;
  username:   string;
  created_at: string;
  avatar_url?: string | null;
}

interface AuthContextType {
  /** 'boot' = splash/loading, 'unauthenticated', 'authenticated' */
  status:         'boot' | 'unauthenticated' | 'authenticated';
  user:           UserInfo | null;
  /** Username already linked to this device (skip new-user flow) */
  deviceUsername: string | null;
  sessionToken:   string | null;

  register:      (username: string, emoji: string[]) => Promise<void>;
  login:         (emoji: string[]) => Promise<void>;
  loginWithUsername: (username: string, emoji: string[]) => Promise<void>;
  recoverInit:   (username: string) => Promise<{ question: string }>;
  recoverVerify: (username: string, answer: string, newEmoji: string[]) => Promise<void>;
  signOut:       () => Promise<void>;
  deleteAccount: (emoji: string[]) => Promise<void>;
  findUser:      (query: string) => Promise<UserInfo[]>;
  checkUsername: (username: string) => Promise<{ available: boolean; reason?: string }>;
  updateUser:    (u: UserInfo) => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

// ─── Provider ────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status,         setStatus]         = useState<'boot' | 'unauthenticated' | 'authenticated'>('boot');
  const [user,           setUser]           = useState<UserInfo | null>(null);
  const [deviceUsername, setDeviceUsername] = useState<string | null>(null);
  const [sessionToken,   setSessionToken]   = useState<string | null>(null);

  // ── Boot: check stored session → fallback to device check ────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Fast path: restore session from secure storage
        const storedToken = await SecureStore.getItemAsync(SESSION_KEY);
        const storedUser  = await SecureStore.getItemAsync(USER_KEY);
        if (storedToken && storedUser) {
          const u = JSON.parse(storedUser) as UserInfo;
          if (mounted) {
            setSessionToken(storedToken);
            setUser(u);
            setStatus('authenticated');
          }
          return; // skip device check — already logged in
        }

        // Check if this device already has a registered account
        try {
          const deviceId = await getOrCreateDeviceId();
          const res = await callAuthFunction({ action: 'check-device', deviceId });
          if (res.found && mounted) {
            setDeviceUsername(res.user.username);
          }
        } catch {}

      } catch {
        // Network or storage error — proceed to normal auth flow
      }
      if (mounted) setStatus('unauthenticated');
    })();
    return () => { mounted = false; };
  }, []);

  // ── Persist helpers ───────────────────────────────────────────────────────
  const saveSession = useCallback(async (token: string, userInfo: UserInfo) => {
    await SecureStore.setItemAsync(SESSION_KEY, token);
    await SecureStore.setItemAsync(USER_KEY,    JSON.stringify(userInfo));
    setSessionToken(token);
    setUser(userInfo);
    setStatus('authenticated');
  }, []);

  // ── Auth actions ──────────────────────────────────────────────────────────
  const register = useCallback(async (username: string, emoji: string[]) => {
    const deviceId = await getOrCreateDeviceId();
    const res = await callAuthFunction({
      action: 'register', username, emojiKey: emoji, deviceId,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const login = useCallback(async (emoji: string[]) => {
    const deviceId = await getOrCreateDeviceId();
    const res = await callAuthFunction({
      action: 'login', emojiKey: emoji, deviceId,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const loginWithUsername = useCallback(async (username: string, emoji: string[]) => {
    const deviceId = await getOrCreateDeviceId();
    const res = await callAuthFunction({
      action: 'login-username', username, emojiKey: emoji, deviceId,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const recoverInit = useCallback(async (username: string) => {
    return callAuthFunction({ action: 'recover-init', username });
  }, []);

  const recoverVerify = useCallback(async (
    username: string, answer: string, newEmoji: string[],
  ) => {
    const res = await callAuthFunction({
      action: 'recover-verify', username, answer, newEmojiKey: newEmoji,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const signOut = useCallback(async () => {
    if (sessionToken) {
      try { await callAuthFunction({ action: 'signout', sessionToken }); } catch {}
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
    setSessionToken(null);
    setDeviceUsername(null);
    setStatus('unauthenticated');
  }, [sessionToken]);

  const deleteAccount = useCallback(async (emoji: string[]) => {
    if (!sessionToken) throw new Error('Not authenticated');
    await callAuthFunction({ action: 'delete-account', sessionToken, emojiKey: emoji });
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
    setSessionToken(null);
    setDeviceUsername(null);
    setStatus('unauthenticated');
  }, [sessionToken]);

  const findUser = useCallback(async (query: string): Promise<UserInfo[]> => {
    if (!sessionToken) return [];
    const res = await callAuthFunction({ action: 'find-user', query, sessionToken });
    return res.users ?? [];
  }, [sessionToken]);

  const checkUsername = useCallback(async (username: string) => {
    return callAuthFunction({ action: 'check-username', username });
  }, []);

  const updateUser = useCallback((u: UserInfo) => {
    setUser(u);
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(u)).catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{
      status, user, deviceUsername, sessionToken,
      register, login, loginWithUsername, recoverInit, recoverVerify,
      signOut, deleteAccount, findUser, checkUsername, updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  return useContext(AuthContext);
}

