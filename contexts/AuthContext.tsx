import * as SecureStore from 'expo-secure-store';
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from 'react';

import { getOrCreateDeviceId } from '@/lib/deviceId';
import { getOrCreatePublicKey } from '@/lib/e2ee';
import { callAuthFunction } from '@/lib/supabase';

// ─── Keys ────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'privy_session_token';
const USER_KEY    = 'privy_user_info';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface UserInfo {
  id:              string;
  username:        string;
  created_at:      string;
  avatar_url?:     string | null;
  // populated only in search results
  requestStatus?:  string;
  chatId?:         string | null;
  peerPublicKey?:  string | null;
}

export interface Message {
  id:             string;
  chat_id:        string;
  sender_id:      string;
  encrypted_body: string;
  msg_type:       'text' | 'image' | 'video' | 'file' | 'voice';
  file_name?:     string | null;
  file_size?:     number | null;
  mime_type?:     string | null;
  status:         'sent' | 'delivered' | 'read';
  created_at:     string;
}

export interface ChatRow {
  chat_id:         string;
  joined_at:       string;
  user:            UserInfo;
  peer_public_key: string | null;
  last_message:    Pick<Message, 'id' | 'encrypted_body' | 'msg_type' | 'sender_id' | 'created_at' | 'status'> | null;
  unread_count:    number;
  last_message_at: string;
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
  sendFriendRequest: (toUserId: string) => Promise<void>;
  getChats:          () => Promise<ChatRow[]>;
  sendMessage:       (chatId: string, encryptedBody: string, msgType?: string, fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string }) => Promise<Message>;
  getMessages:       (chatId: string, before?: string) => Promise<Message[]>;
  markRead:          (chatId: string) => Promise<void>;
  deleteMessage:     (messageId: string, forEveryone: boolean) => Promise<void>;
  deleteChat:        (chatId: string) => Promise<void>;
  openChat:          (peerId: string) => Promise<{ chatId: string; peerPublicKey: string | null }>;
  removeFriend:      (peerId: string) => Promise<void>;
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
          // Re-upload ECDH public key on every boot — retry up to 5 times so
          // transient network/crypto errors don't silently leave the key missing.
          (async () => {
            for (let i = 0; i < 5; i++) {
              try {
                const publicKey = await getOrCreatePublicKey();
                await callAuthFunction({ action: 'store-public-key', sessionToken: storedToken, publicKey });
                break; // success
              } catch {
                await new Promise(r => setTimeout(r, 2000 * (i + 1)));
              }
            }
          })();
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
    // Upload ECDH public key — retry up to 5 times
    (async () => {
      for (let i = 0; i < 5; i++) {
        try {
          const publicKey = await getOrCreatePublicKey();
          await callAuthFunction({ action: 'store-public-key', sessionToken: token, publicKey });
          break;
        } catch {
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
    })();
  }, []);
  const register = useCallback(async (username: string, emoji: string[]) => {
    const deviceId  = await getOrCreateDeviceId();
    const publicKey = await getOrCreatePublicKey();   // generate key BEFORE the server call
    const res = await callAuthFunction({
      action: 'register', username, emojiKey: emoji, deviceId, publicKey,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const login = useCallback(async (emoji: string[]) => {
    const deviceId  = await getOrCreateDeviceId();
    const publicKey = await getOrCreatePublicKey();
    const res = await callAuthFunction({
      action: 'login', emojiKey: emoji, deviceId, publicKey,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const loginWithUsername = useCallback(async (username: string, emoji: string[]) => {
    const deviceId  = await getOrCreateDeviceId();
    const publicKey = await getOrCreatePublicKey();
    const res = await callAuthFunction({
      action: 'login-username', username, emojiKey: emoji, deviceId, publicKey,
    });
    await saveSession(res.sessionToken, res.user);
  }, [saveSession]);

  const recoverInit = useCallback(async (username: string) => {
    return callAuthFunction({ action: 'recover-init', username });
  }, []);

  const recoverVerify = useCallback(async (
    username: string, answer: string, newEmoji: string[],
  ) => {
    const publicKey = await getOrCreatePublicKey();
    const res = await callAuthFunction({
      action: 'recover-verify', username, answer, newEmojiKey: newEmoji, publicKey,
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

  const sendFriendRequest = useCallback(async (toUserId: string) => {
    if (!sessionToken) throw new Error('Not authenticated');
    await callAuthFunction({ action: 'send-request', sessionToken, toUserId });
  }, [sessionToken]);

  const getChats = useCallback(async (): Promise<ChatRow[]> => {
    if (!sessionToken) return [];
    const res = await callAuthFunction({ action: 'get-chats', sessionToken });
    return res.chats ?? [];
  }, [sessionToken]);

  const sendMessage = useCallback(async (
    chatId: string,
    encryptedBody: string,
    msgType = 'text',
    fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string },
  ): Promise<Message> => {
    if (!sessionToken) throw new Error('Not authenticated');
    const res = await callAuthFunction({
      action: 'send-message', sessionToken, chatId,
      encryptedBody, msgType, ...fileMeta,
    });
    return res.message as Message;
  }, [sessionToken]);

  const getMessages = useCallback(async (chatId: string, before?: string): Promise<Message[]> => {
    if (!sessionToken) return [];
    const res = await callAuthFunction({ action: 'get-messages', sessionToken, chatId, before });
    return (res.messages ?? []) as Message[];
  }, [sessionToken]);

  const markRead = useCallback(async (chatId: string): Promise<void> => {
    if (!sessionToken) return;
    await callAuthFunction({ action: 'mark-read', sessionToken, chatId });
  }, [sessionToken]);

  const deleteMessage = useCallback(async (messageId: string, forEveryone: boolean): Promise<void> => {
    if (!sessionToken) throw new Error('Not authenticated');
    await callAuthFunction({ action: 'delete-message', sessionToken, messageId, forEveryone });
  }, [sessionToken]);

  const deleteChat = useCallback(async (chatId: string): Promise<void> => {
    if (!sessionToken) throw new Error('Not authenticated');
    await callAuthFunction({ action: 'delete-chat', sessionToken, chatId });
  }, [sessionToken]);

  const openChat = useCallback(async (peerId: string): Promise<{ chatId: string; peerPublicKey: string | null }> => {
    if (!sessionToken) throw new Error('Not authenticated');
    const res = await callAuthFunction({ action: 'open-chat', sessionToken, peerId });
    return { chatId: res.chatId as string, peerPublicKey: (res.peerPublicKey as string | null) ?? null };
  }, [sessionToken]);

  const removeFriend = useCallback(async (peerId: string): Promise<void> => {
    if (!sessionToken) throw new Error('Not authenticated');
    await callAuthFunction({ action: 'remove-friend', sessionToken, peerId });
  }, [sessionToken]);

  return (
    <AuthContext.Provider value={{
      status, user, deviceUsername, sessionToken,
      register, login, loginWithUsername, recoverInit, recoverVerify,
      signOut, deleteAccount, findUser, checkUsername, updateUser,
      sendFriendRequest, getChats,
      sendMessage, getMessages, markRead, deleteMessage, deleteChat, openChat, removeFriend,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  return useContext(AuthContext);
}

