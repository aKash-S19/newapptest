import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getOrCreateDeviceId } from '@/lib/deviceId';
import { getOrCreatePublicKey } from '@/lib/e2ee';
import { callAuthFunction } from '@/lib/supabase';

const LAST_USERNAME_KEY = 'privy_last_username';
const SESSION_TOKEN_KEY = 'privy_session_token';

export interface UserInfo {
  id:              string;
  username:        string;
  created_at:      string;
  avatar_url?:     string | null;
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

export interface GroupRow {
  id: string;
  name: string;
  role: 'member' | 'admin' | 'super_admin';
  announcement_mode: boolean;
  invite_requires_approval: boolean;
  restrict_forwarding: boolean;
  key_version: number;
  created_by: string;
  joined_at: string;
  unread_count: number;
  last_message: {
    id: string;
    sender_id: string;
    msg_type: 'text' | 'image' | 'video' | 'file' | 'voice';
    created_at: string;
  } | null;
  last_message_at: string;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: 'member' | 'admin' | 'super_admin';
  muted_until?: string | null;
  joined_at: string;
  user: { id: string; username: string; avatar_url?: string | null; public_key?: string | null };
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  encrypted_body: string;
  key_version: number;
  msg_type: 'text' | 'image' | 'video' | 'file' | 'voice';
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  forwarded_from?: string | null;
  created_at: string;
}

export type CallSignalType = 'offer' | 'answer' | 'ice' | 'end' | 'decline' | 'busy';

export interface CallSignal {
  id: string;
  call_id: string;
  chat_id: string;
  from_user_id: string;
  to_user_id: string;
  signal_type: CallSignalType;
  signal_payload: string | null;
  created_at: string;
}

interface AuthContextType {
  status:         'boot' | 'unauthenticated' | 'authenticated';
  user:           UserInfo | null;
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
  getMessages:       (chatId: string, before?: string, after?: string) => Promise<Message[]>;
  markRead:          (chatId: string) => Promise<void>;
  deleteMessage:     (messageId: string, forEveryone: boolean) => Promise<void>;
  deleteChat:        (chatId: string) => Promise<void>;
  openChat:          (peerId: string) => Promise<{ chatId: string; peerPublicKey: string | null }>;
  removeFriend:      (peerId: string) => Promise<void>;
  sendGroupMessage:  (groupId: string, encryptedBody: string, msgType?: string, fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string }) => Promise<Message>;
  getGroupMessages:  (groupId: string, before?: string) => Promise<Message[]>;
  sendCallSignal:    (chatId: string, toUserId: string, callId: string, signalType: CallSignalType, signalPayload?: string | null) => Promise<{ id: string; created_at: string }>;
  getCallSignals:    (chatId: string, options?: { since?: string; callId?: string }) => Promise<CallSignal[]>;
  ackCallSignals:    (signalIds: string[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

async function getSessionUser(sessionToken: string): Promise<UserInfo | null> {
  const res = await callAuthFunction({ action: 'get-session-user', sessionToken });
  return (res.user ?? null) as UserInfo | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'boot' | 'unauthenticated' | 'authenticated'>('boot');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [deviceUsername, setDeviceUsername] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const storedUsername = await SecureStore.getItemAsync(LAST_USERNAME_KEY);
      if (mounted) setDeviceUsername(storedUsername ?? null);

      const storedToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
      if (!mounted) return;
      if (storedToken) {
        try {
          const profile = await getSessionUser(storedToken);
          if (profile) {
            setSessionToken(storedToken);
            setUser(profile);
            setStatus('authenticated');
            await SecureStore.setItemAsync(LAST_USERNAME_KEY, profile.username);
            setDeviceUsername(profile.username);
            return;
          }
        } catch {
          // Ignore and fall through to unauthenticated.
        }
      }
      setSessionToken(null);
      setUser(null);
      setStatus('unauthenticated');
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const storeSession = useCallback(async (nextUser: UserInfo, token: string) => {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    await SecureStore.setItemAsync(LAST_USERNAME_KEY, nextUser.username);
    setSessionToken(token);
    setUser(nextUser);
    setDeviceUsername(nextUser.username);
    setStatus('authenticated');
  }, []);

  const clearSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    setSessionToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const register = useCallback(async (username: string, emoji: string[]) => {
    const uname = username.trim().toLowerCase();
    const deviceId = await getOrCreateDeviceId();
    const publicKey = await getOrCreatePublicKey();
    const res = await callAuthFunction({
      action: 'register',
      username: uname,
      emojiKey: emoji,
      deviceId,
      publicKey,
    });
    if (!res?.user || !res?.sessionToken) throw new Error('Account creation failed');
    await storeSession(res.user as UserInfo, res.sessionToken as string);
  }, [storeSession]);

  const loginWithUsername = useCallback(async (username: string, emoji: string[]) => {
    const uname = username.trim().toLowerCase();
    const deviceId = await getOrCreateDeviceId();
    const publicKey = await getOrCreatePublicKey();
    const res = await callAuthFunction({
      action: 'login-username',
      username: uname,
      emojiKey: emoji,
      deviceId,
      publicKey,
    });
    if (!res?.user || !res?.sessionToken) throw new Error('Invalid username or emoji key');
    await storeSession(res.user as UserInfo, res.sessionToken as string);
  }, [storeSession]);

  const login = useCallback(async (emoji: string[]) => {
    if (!deviceUsername) throw new Error('Missing username');
    await loginWithUsername(deviceUsername, emoji);
  }, [deviceUsername, loginWithUsername]);

  const recoverInit = useCallback(async (username: string) => {
    return callAuthFunction({ action: 'recover-init', username });
  }, []);

  const recoverVerify = useCallback(async (username: string, answer: string, newEmoji: string[]) => {
    const res = await callAuthFunction({ action: 'recover-verify', username, answer, newEmojiKey: newEmoji });
    if (res?.username) {
      await SecureStore.setItemAsync(LAST_USERNAME_KEY, res.username);
      setDeviceUsername(res.username);
    }
  }, []);

  const signOut = useCallback(async () => {
    await callAuthFunction({ action: 'signout', sessionToken });
    await clearSession();
  }, [sessionToken, clearSession]);

  const deleteAccount = useCallback(async (emoji: string[]) => {
    await callAuthFunction({ action: 'delete-account', emojiKey: emoji, sessionToken });
    await clearSession();
  }, [sessionToken, clearSession]);

  const findUser = useCallback(async (query: string): Promise<UserInfo[]> => {
    const res = await callAuthFunction({ action: 'find-user', query, sessionToken });
    return res.users ?? [];
  }, [sessionToken]);

  const checkUsername = useCallback(async (username: string) => {
    return callAuthFunction({ action: 'check-username', username });
  }, []);

  const updateUser = useCallback((u: UserInfo) => {
    setUser(u);
  }, []);

  const sendFriendRequest = useCallback(async (toUserId: string) => {
    await callAuthFunction({ action: 'send-request', toUserId, sessionToken });
  }, [sessionToken]);

  const getChats = useCallback(async (): Promise<ChatRow[]> => {
    const res = await callAuthFunction({ action: 'get-chats', sessionToken });
    return res.chats ?? [];
  }, [sessionToken]);

  const sendMessage = useCallback(async (
    chatId: string,
    encryptedBody: string,
    msgType = 'text',
    fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string },
  ): Promise<Message> => {
    const res = await callAuthFunction({
      action: 'send-message', chatId, encryptedBody, msgType, ...fileMeta, sessionToken,
    });
    return res.message as Message;
  }, [sessionToken]);

  const sendGroupMessage = useCallback(async (
    groupId: string,
    encryptedBody: string,
    msgType = 'text',
    fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string },
  ): Promise<Message> => {
    const res = await callAuthFunction({
      action: 'send-group-message', groupId, encryptedBody, msgType, ...fileMeta, sessionToken,
    });
    return res.message as Message;
  }, [sessionToken]);

  const getGroupMessages = useCallback(async (groupId: string, before?: string): Promise<Message[]> => {
    const res = await callAuthFunction({ action: 'get-group-messages', groupId, before, after: before, sessionToken });
    return (res.messages ?? []) as Message[];
  }, [sessionToken]);

  const sendCallSignal = useCallback(async (
    chatId: string,
    toUserId: string,
    callId: string,
    signalType: CallSignalType,
    signalPayload?: string | null,
  ): Promise<{ id: string; created_at: string }> => {
    const res = await callAuthFunction({
      action: 'send-call-signal',
      chatId,
      toUserId,
      callId,
      signalType,
      signalPayload: signalPayload ?? null,
      sessionToken,
    });
    return {
      id: String(res?.signal?.id ?? ''),
      created_at: String(res?.signal?.created_at ?? new Date().toISOString()),
    };
  }, [sessionToken]);

  const getCallSignals = useCallback(async (
    chatId: string,
    options?: { since?: string; callId?: string },
  ): Promise<CallSignal[]> => {
    const res = await callAuthFunction({
      action: 'get-call-signals',
      chatId,
      since: options?.since,
      callId: options?.callId,
      sessionToken,
    });
    return (res.signals ?? []) as CallSignal[];
  }, [sessionToken]);

  const ackCallSignals = useCallback(async (signalIds: string[]): Promise<void> => {
    if (signalIds.length === 0) return;
    await callAuthFunction({ action: 'ack-call-signals', signalIds, sessionToken });
  }, [sessionToken]);

  const getMessages = useCallback(async (chatId: string, before?: string, after?: string): Promise<Message[]> => {
    const res = await callAuthFunction({ action: 'get-messages', chatId, before, after, sessionToken });
    return (res.messages ?? []) as Message[];
  }, [sessionToken]);

  const markRead = useCallback(async (chatId: string): Promise<void> => {
    await callAuthFunction({ action: 'mark-read', chatId, sessionToken });
  }, [sessionToken]);

  const deleteMessage = useCallback(async (messageId: string, forEveryone: boolean): Promise<void> => {
    await callAuthFunction({ action: 'delete-message', messageId, forEveryone, sessionToken });
  }, [sessionToken]);

  const deleteChat = useCallback(async (chatId: string): Promise<void> => {
    await callAuthFunction({ action: 'delete-chat', chatId, sessionToken });
  }, [sessionToken]);

  const openChat = useCallback(async (peerId: string): Promise<{ chatId: string; peerPublicKey: string | null }> => {
    const res = await callAuthFunction({ action: 'open-chat', peerId, sessionToken });
    return { chatId: res.chatId as string, peerPublicKey: (res.peerPublicKey as string | null) ?? null };
  }, [sessionToken]);

  const removeFriend = useCallback(async (peerId: string): Promise<void> => {
    await callAuthFunction({ action: 'remove-friend', peerId, sessionToken });
  }, [sessionToken]);

  const value = useMemo(() => ({
    status, user, deviceUsername, sessionToken,
    register, login, loginWithUsername, recoverInit, recoverVerify,
    signOut, deleteAccount, findUser, checkUsername, updateUser,
    sendFriendRequest, getChats,
    sendMessage, getMessages, markRead, deleteMessage, deleteChat, openChat, removeFriend,
    sendGroupMessage, getGroupMessages,
    sendCallSignal, getCallSignals, ackCallSignals,
  }), [
    status, user, deviceUsername, sessionToken,
    register, login, loginWithUsername, recoverInit, recoverVerify,
    signOut, deleteAccount, findUser, checkUsername, updateUser,
    sendFriendRequest, getChats,
    sendMessage, getMessages, markRead, deleteMessage, deleteChat, openChat, removeFriend,
    sendGroupMessage, getGroupMessages,
    sendCallSignal, getCallSignals, ackCallSignals,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
