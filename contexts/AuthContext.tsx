import React, {
    createContext,
    useCallback,
    useContext,
    useState,
} from 'react';

import { callAuthFunction } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────
interface UserInfo {
  id: string;
  username: string;
  created_at: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserInfo | null;
  emojiKey: string[];
  register: (username: string, emoji: string[]) => Promise<void>;
  login: (username: string, emoji: string[]) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  emojiKey: [],
  register: async () => {},
  login: async () => {},
  signOut: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [emojiKey, setEmojiKey] = useState<string[]>([]);

  const register = useCallback(async (username: string, emoji: string[]) => {
    const result = await callAuthFunction({ action: 'register', username, emojiKey: emoji });
    setUser(result.user);
    setEmojiKey(emoji);
    setIsAuthenticated(true);
  }, []);

  const login = useCallback(async (username: string, emoji: string[]) => {
    const result = await callAuthFunction({ action: 'login', username, emojiKey: emoji });
    setUser(result.user);
    setEmojiKey(emoji);
    setIsAuthenticated(true);
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setEmojiKey([]);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, emojiKey, register, login, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

