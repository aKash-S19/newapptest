/**
 * app/chat/group/[id].tsx – Group chat screen
 * WhatsApp-style responsive UI with proper safe area handling
 */

import { useAuth, type Message as BaseMessage } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
    decryptGroupKeyFromPeer,
    decryptMessage,
    encryptGroupKeyForPeer,
    encryptMessage,
    generateGroupKey,
    getStoredGroupKey,
    storeGroupKey,
} from '@/lib/e2ee';
import { callAuthFunction } from '@/lib/supabase';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GroupMessage extends BaseMessage {
  text?: string;
  user: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  imageB64?: string;
  fileData?: { b64: string; name: string; size: number; mimeType: string };
  pending?: boolean;
  failed?: boolean;
}

interface GroupInfo {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isGroupUnavailableError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes('group not found') || msg.includes('not a group member');
}

function parseGroupPayload(msg: BaseMessage, plaintext: string): Pick<GroupMessage, 'text' | 'imageB64' | 'fileData'> {
  if (msg.msg_type === 'image') {
    let imageB64 = '';
    try { imageB64 = JSON.parse(plaintext).b64 ?? ''; } catch {}
    return { imageB64 };
  }
  if (msg.msg_type === 'file') {
    let fileData: GroupMessage['fileData'] | undefined;
    try { fileData = JSON.parse(plaintext); } catch {}
    return { fileData };
  }
  return { text: plaintext };
}

function toGroupMessage(msg: BaseMessage, userInfo: GroupMessage['user'], plaintext: string): GroupMessage {
  return { ...msg, ...parseGroupPayload(msg, plaintext), user: userInfo } as GroupMessage;
}

function matchesPendingGroupMessage(pending: GroupMessage, incoming: GroupMessage): boolean {
  if (!pending.pending || pending.msg_type !== incoming.msg_type) return false;
  if (pending.msg_type === 'text') return (pending.text ?? '') === (incoming.text ?? '');
  if (pending.msg_type === 'image') return !!pending.imageB64 && pending.imageB64 === incoming.imageB64;
  if (pending.msg_type === 'file') {
    return !!pending.fileData && !!incoming.fileData && pending.fileData.name === incoming.fileData.name && pending.fileData.size === incoming.fileData.size;
  }
  return false;
}

const GroupChatScreen = () => {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user, sessionToken, sendGroupMessage, getGroupMessages } = useAuth();
  const th = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const latestMessageAtRef = useRef<string | null>(null);
  const handledMissingGroupRef = useRef(false);

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [showAttachTray, setShowAttachTray] = useState(false);
  const [groupKey, setGroupKey] = useState<Uint8Array | null>(null);
  const [groupKeyError, setGroupKeyError] = useState<string | null>(null);
  const sendGroupMessageWithMeta = sendGroupMessage as (
    groupId: string,
    encryptedBody: string,
    msgType?: string,
    fileMeta?: { fileName?: string; fileSize?: number; mimeType?: string },
  ) => Promise<BaseMessage>;

  const fetchGroupContext = useCallback(async () => {
    if (!groupId || !sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'get-group-chat-context', sessionToken, groupId });
      if (res?.group) setGroupInfo(res.group as GroupInfo);
      if (Array.isArray(res?.members)) setMembers(res.members as any[]);
    } catch (error) {
      if (isGroupUnavailableError(error)) {
        if (!handledMissingGroupRef.current) {
          handledMissingGroupRef.current = true;
          Alert.alert('Group unavailable', 'This group no longer exists or you no longer have access.');
          router.replace('/(tabs)/groups');
        }
        return;
      }
      console.error('Error fetching group context:', error);
    }
  }, [groupId, sessionToken, router]);

  const fetchMessages = useCallback(async (
    after?: string,
    background = false,
  ): Promise<GroupMessage[]> => {
    if (!groupId || !groupKey) return [];
    if (!after && !background) setLoading(true);
    try {
      const msgData = await getGroupMessages(groupId, after);

      const formattedMessages = await Promise.all(msgData.map(async (msg: any) => {
        const sender = msg.sender as GroupMessage['user'] | undefined;
        const userInfo = sender?.id
          ? sender
          : { id: msg.sender_id, username: 'Unknown', avatar_url: null };
        let plaintext = '';
        try {
          plaintext = await decryptMessage(groupKey, msg.encrypted_body);
        } catch {
          plaintext = '🔒 Unable to decrypt';
        }
        return toGroupMessage(msg as BaseMessage, userInfo, plaintext);
      }));

      if (!after) {
        setMessages(formattedMessages);
        knownMessageIdsRef.current = new Set(formattedMessages.map((m) => m.id));
      } else if (formattedMessages.length > 0) {
        const newlySeen = formattedMessages.filter((m) => !knownMessageIdsRef.current.has(m.id));
        newlySeen.forEach((m) => knownMessageIdsRef.current.add(m.id));

        setMessages((prev) => {
          const next = [...prev];
          for (const incoming of formattedMessages) {
            const byId = next.findIndex((m) => m.id === incoming.id);
            if (byId !== -1) {
              next[byId] = { ...next[byId], ...incoming, pending: false, failed: false };
              continue;
            }
            const optimistic = next.findIndex(
              (m) => m.sender_id === incoming.sender_id && matchesPendingGroupMessage(m, incoming),
            );
            if (optimistic !== -1) {
              next[optimistic] = { ...incoming, pending: false, failed: false };
              continue;
            }
            next.push(incoming);
          }
          next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          return next;
        });

        if (formattedMessages.length > 0) {
          setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 100);
        }
      }

      return formattedMessages;
    } catch (error) {
      if (isGroupUnavailableError(error)) {
        if (!handledMissingGroupRef.current) {
          handledMissingGroupRef.current = true;
          Alert.alert('Group unavailable', 'This group no longer exists or you no longer have access.');
          router.replace('/(tabs)/groups');
        }
        return [];
      }
      console.error('Error fetching messages:', error);
      return [];
    } finally {
      if (!after && !background) setLoading(false);
    }
  }, [groupId, groupKey, getGroupMessages, router]);

  const ensureGroupKey = useCallback(async () => {
    if (!groupId || !user || !sessionToken) return;
    setGroupKeyError(null);

    try {
      const state = await callAuthFunction({ action: 'get-group-key-state', sessionToken, groupId });
      const role = String(state?.role ?? 'member');
      const memberIds = Array.isArray(state?.memberIds) ? (state.memberIds as string[]) : [];
      const existing = new Set(
        Array.isArray(state?.existingKeyUserIds) ? (state.existingKeyUserIds as string[]) : [],
      );
      const publicKeyRows = Array.isArray(state?.publicKeys) ? state.publicKeys as { user_id: string; public_key: string }[] : [];
      const keyMap = new Map<string, string>();
      publicKeyRows.forEach((k) => {
        if (k?.user_id && k?.public_key) keyMap.set(k.user_id, k.public_key);
      });

      const upsertFor = async (key: Uint8Array, targets: string[]) => {
        const rows = await Promise.all(targets.map(async (memberId) => {
          const pub = keyMap.get(memberId);
          if (!pub) return null;
          const enc = await encryptGroupKeyForPeer(pub, key);
          return {
            user_id: memberId,
            sender_id: user.id,
            encrypted_key: enc,
          };
        }));

        const payload = rows.filter(Boolean) as { user_id: string; sender_id: string; encrypted_key: string }[];
        if (payload.length > 0) {
          await callAuthFunction({
            action: 'upsert-group-keys',
            sessionToken,
            groupId,
            rows: payload,
          });
        }
      };

      const syncMissing = async (key: Uint8Array) => {
        if (role !== 'admin') return;
        const missing = memberIds.filter((id) => !existing.has(id));
        if (missing.length === 0) return;
        await upsertFor(key, missing);
      };

      const cached = await getStoredGroupKey(groupId);
      if (cached) {
        setGroupKey(cached);
        await syncMissing(cached);
        return;
      }

      const ownKey = (state?.ownKey ?? null) as { encrypted_key?: string; sender_id?: string } | null;
      if (ownKey?.encrypted_key) {
        const senderPublicKey = String(state?.senderPublicKey ?? '');
        if (!senderPublicKey) {
          setGroupKeyError('Missing key material');
          return;
        }
        const key = await decryptGroupKeyFromPeer(senderPublicKey, ownKey.encrypted_key);
        await storeGroupKey(groupId, key);
        setGroupKey(key);
        await syncMissing(key);
        return;
      }

      if (role !== 'admin') {
        setGroupKeyError('Group key unavailable');
        return;
      }

      const newKey = generateGroupKey();
      await upsertFor(newKey, memberIds);
      await storeGroupKey(groupId, newKey);
      setGroupKey(newKey);
      await syncMissing(newKey);
    } catch (error) {
      if (isGroupUnavailableError(error)) {
        if (!handledMissingGroupRef.current) {
          handledMissingGroupRef.current = true;
          Alert.alert('Group unavailable', 'This group no longer exists or you no longer have access.');
          router.replace('/(tabs)/groups');
        }
        return;
      }
      console.error('Error ensuring group key:', error);
      setGroupKeyError('Group key unavailable');
    }
  }, [groupId, sessionToken, user, router]);

  useEffect(() => {
    fetchGroupContext();
    ensureGroupKey();
  }, [fetchGroupContext, ensureGroupKey]);

  useEffect(() => {
    if (!groupKey || !groupId) return;

    let cancelled = false;

    const bootstrap = async () => {
      const initial = await fetchMessages(undefined, false);
      if (cancelled) return;
      latestMessageAtRef.current = initial.length > 0 ? initial[initial.length - 1].created_at : null;
      if (initial.length > 0) {
        setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: false }); }, 100);
      }
    };

    bootstrap();

    const timer = setInterval(async () => {
      if (cancelled) return;
      const after = latestMessageAtRef.current ?? undefined;
      const updates = await fetchMessages(after, true);
      if (updates.length > 0) {
        latestMessageAtRef.current = updates[updates.length - 1].created_at;
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [groupId, groupKey, fetchMessages]);

  const onSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !user || !groupId || sending) return;
    if (!groupKey) { setGroupKeyError('Group key unavailable'); return; }

    setSending(true);
    setInputText('');

    // Add optimistic message immediately
    const optimisticMessage: GroupMessage = {
      id: `temp-${Date.now()}`,
      text,
      created_at: new Date().toISOString(),
      msg_type: 'text',
      chat_id: '',
      sender_id: user.id,
      encrypted_body: text,
      status: 'sent',
      pending: true,
      user: {
        id: user.id,
        username: user.username || 'You',
        avatar_url: user.avatar_url || null,
      },
    };
    setMessages(prev => [...prev, optimisticMessage]);
    setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 100);

    try {
      const encrypted = await encryptMessage(groupKey, text);
      await sendGroupMessage(groupId, encrypted, 'text');
    } catch (error) {
      console.error('Error sending message:', error);
      setInputText(text);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
    }
    setSending(false);
  }, [inputText, user, groupId, sending, sendGroupMessage, groupKey]);

  const handlePickImage = useCallback(async () => {
    if (!groupId || !user) return;
    if (!groupKey) { setGroupKeyError('Group key unavailable'); return; }
    setShowAttachTray(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) return;

    setSending(true);
    const tempId = `temp-img-${Date.now()}`;
    const optimistic: GroupMessage = {
      id: tempId,
      chat_id: '',
      sender_id: user.id,
      encrypted_body: JSON.stringify({ b64 }),
      msg_type: 'image',
      status: 'sent',
      created_at: new Date().toISOString(),
      imageB64: b64,
      user: { id: user.id, username: user.username || 'You', avatar_url: user.avatar_url || null },
      pending: true,
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const encrypted = await encryptMessage(groupKey, JSON.stringify({ b64 }));
      await sendGroupMessageWithMeta(groupId, encrypted, 'image', { mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m));
    } finally { setSending(false); }
  }, [groupId, user, sendGroupMessageWithMeta, groupKey]);

  const handlePickDocument = useCallback(async () => {
    if (!groupId || !user) return;
    if (!groupKey) { setGroupKeyError('Group key unavailable'); return; }
    setShowAttachTray(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 as any });
    const payload = { b64, name: asset.name, size: asset.size ?? 0, mimeType: asset.mimeType ?? 'application/octet-stream' };

    setSending(true);
    const tempId = `temp-file-${Date.now()}`;
    const optimistic: GroupMessage = {
      id: tempId,
      chat_id: '',
      sender_id: user.id,
      encrypted_body: JSON.stringify(payload),
      msg_type: 'file',
      status: 'sent',
      created_at: new Date().toISOString(),
      fileData: payload,
      user: { id: user.id, username: user.username || 'You', avatar_url: user.avatar_url || null },
      pending: true,
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const encrypted = await encryptMessage(groupKey, JSON.stringify(payload));
      await sendGroupMessageWithMeta(groupId, encrypted, 'file', { fileName: asset.name, fileSize: asset.size ?? 0, mimeType: asset.mimeType ?? 'application/octet-stream' });
    } catch {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m));
    } finally { setSending(false); }
  }, [groupId, user, sendGroupMessageWithMeta, groupKey]);

  const handleFileOpen = useCallback(async (data: { b64: string; name: string; mimeType: string }) => {
    const tmpPath = (FileSystem.cacheDirectory ?? '') + data.name;
    await FileSystem.writeAsStringAsync(tmpPath, data.b64, { encoding: 'base64' as any });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(tmpPath, { mimeType: data.mimeType, dialogTitle: data.name });
  }, []);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatMessageTimestamp = (dateStr: string) => {
    const date = new Date(dateStr);
    const label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${label} - ${formatTime(dateStr)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === now.toDateString()) return 'Today';
    else if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const shouldShowDate = (currentMsg: GroupMessage, prevMsg: GroupMessage | null) => {
    if (!prevMsg) return true;
    return new Date(currentMsg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
  };

  const getAvatarColor = (userId: string) => {
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
    const index = userId.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const renderMessage = ({ item, index }: { item: GroupMessage; index: number }) => {
    const isOwnMessage = item.user.id === user?.id;
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const showDate = shouldShowDate(item, prevMessage);
    const isConsecutive = prevMessage && prevMessage.user.id === item.user.id;

    return (
      <View>
        {showDate && (
          <View style={styles.dateContainer}>
            <Text style={[styles.dateText, { color: th.textSoft }]}>{formatDate(item.created_at)}</Text>
          </View>
        )}

        <View style={[styles.messageRow, isOwnMessage && styles.messageRowOwn, isConsecutive && styles.messageRowConsecutive]}>
          {!isOwnMessage && !isConsecutive && (
            item.user.avatar_url ? (
              <Image source={{ uri: item.user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: getAvatarColor(item.user.id) + '20' }]}>
                <Text style={[styles.avatarText, { color: getAvatarColor(item.user.id) }]}>
                  {item.user.username?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )
          )}

          {!isOwnMessage && !isConsecutive && <View style={styles.nameSpacer} />}

          <View style={[
            styles.messageBubble,
            isOwnMessage ? { backgroundColor: th.accent } : { backgroundColor: th.cardBg },
            isConsecutive && (isOwnMessage ? styles.bubbleConsecutiveOwn : styles.bubbleConsecutive),
          ]}>
            {!isOwnMessage && !isConsecutive && (
              <Text style={[styles.senderName, { color: th.accent }]}>{item.user.username}</Text>
            )}
            {item.msg_type === 'image' && item.imageB64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${item.imageB64}` }} style={styles.msgImage} resizeMode="cover" />
            ) : item.msg_type === 'file' && item.fileData ? (
              <Pressable style={styles.fileCard} onPress={() => handleFileOpen(item.fileData!)}>
                <MaterialCommunityIcons name="file-outline" size={18} color={isOwnMessage ? '#fff' : th.accent} />
                <Text style={[styles.fileName, { color: isOwnMessage ? '#fff' : th.textDark }]} numberOfLines={1}>{item.fileData.name}</Text>
              </Pressable>
            ) : (
              <Text style={[styles.messageText, { color: isOwnMessage ? '#fff' : th.textDark }]}>
                {item.text}
              </Text>
            )}
            <Text style={[styles.messageTime, { color: isOwnMessage ? 'rgba(255,255,255,0.7)' : th.textSoft }]}>
              {formatMessageTimestamp(item.created_at)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderGroupAvatar = () => {
    if (groupInfo?.avatar_url) return <Image source={{ uri: groupInfo.avatar_url }} style={styles.headerAvatar} />;
    return (
      <View style={[styles.headerAvatarPlaceholder, { backgroundColor: th.accent + '20' }]}>
        <MaterialCommunityIcons name="account-group" size={20} color={th.accent} />
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      {/* Header with proper safe area handling */}
      <View style={[styles.header, { backgroundColor: th.cardBg, borderBottomColor: th.divider, paddingTop: insets.top, height: 56 + insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={th.textDark} />
        </Pressable>

        <TouchableOpacity style={styles.headerInfo} onPress={() => router.push(`/chat/group/info?id=${groupId}`)}>
          {renderGroupAvatar()}
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: th.textDark }]} numberOfLines={1}>
              {groupInfo?.name || 'Group Chat'}
            </Text>
            <Text style={[styles.headerSubtitle, { color: th.textSoft }]} numberOfLines={1}>
              {members.length} member{members.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </TouchableOpacity>

        <Pressable style={styles.infoButton} onPress={() => router.push(`/chat/group/info?id=${groupId}`)} hitSlop={12}>
          <MaterialCommunityIcons name="dots-vertical" size={24} color={th.textMed} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages list */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={th.accent} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={[styles.messagesList, { paddingBottom: 8, flexGrow: 1 }]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => { if (messages.length > 0) flatListRef.current?.scrollToEnd({ animated: false }); }}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => Keyboard.dismiss()}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIcon, { backgroundColor: th.accent + '10' }]}>
                  <MaterialCommunityIcons name="chat-outline" size={40} color={th.accent} />
                </View>
                <Text style={[styles.emptyTitle, { color: th.textDark }]}>No messages yet</Text>
                <Text style={[styles.emptyText, { color: th.textMed }]}>Start the conversation with your group</Text>
              </View>
            }
          />
        )}

        {/* Input container */}
        {showAttachTray && (
          <View style={[styles.attachTray, { backgroundColor: th.cardBg, borderTopColor: th.divider, paddingBottom: Math.max(insets.bottom, 8) }]}>
            <Pressable style={[styles.trayBtn, { backgroundColor: th.inputBg }]} onPress={handlePickImage} disabled={sending}>
              <MaterialCommunityIcons name="image-multiple-outline" size={24} color={th.accent} />
              <Text style={[styles.trayLabel, { color: th.textSoft }]}>Photo</Text>
            </Pressable>
            <Pressable style={[styles.trayBtn, { backgroundColor: th.inputBg }]} onPress={handlePickDocument} disabled={sending}>
              <MaterialCommunityIcons name="file-document-outline" size={24} color={th.accent} />
              <Text style={[styles.trayLabel, { color: th.textSoft }]}>Document</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.inputContainer, { backgroundColor: th.cardBg, borderTopColor: th.divider, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable style={[styles.attachButton, { backgroundColor: th.inputBg }]} onPress={() => setShowAttachTray(v => !v)}>
            <MaterialCommunityIcons name={showAttachTray ? 'close' : 'plus'} size={20} color={th.textMed} />
          </Pressable>
          <View style={[styles.inputWrapper, { backgroundColor: th.inputBg }]}>
            <TextInput
              style={[styles.input, { color: th.textDark }]}
              placeholder="Type a message..."
              placeholderTextColor={th.textSoft}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              blurOnSubmit={false}
              onSubmitEditing={onSend}
            />
          </View>

          <Pressable
            style={[styles.sendButton, { backgroundColor: th.accent }, (!inputText.trim() || sending) && { opacity: 0.5 }]}
            onPress={onSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <MaterialCommunityIcons name="send" size={20} color="white" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 8, marginRight: 4 },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  headerSubtitle: { fontSize: 13 },
  infoButton: { padding: 8 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { paddingHorizontal: 16, paddingTop: 8, flexGrow: 1 },
  dateContainer: { alignItems: 'center', marginVertical: 12 },
  dateText: {
    fontSize: 12,
    fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  messageRowOwn: { alignSelf: 'flex-end' },
  messageRowConsecutive: { marginBottom: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: { fontSize: 14, fontWeight: '600' },
  nameSpacer: { width: 40, marginRight: 8 },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    maxWidth: '80%',
  },
  msgImage: { width: 220, height: 160, borderRadius: 12, marginBottom: 6 },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  fileName: { fontSize: 14, maxWidth: 200 },
  bubbleConsecutive: { borderTopLeftRadius: 4 },
  bubbleConsecutiveOwn: { borderTopRightRadius: 4 },
  senderName: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  messageText: { fontSize: 15, lineHeight: 20 },
  messageTime: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  attachTray: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  trayBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  trayLabel: { fontSize: 13, fontWeight: '600' },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
  },
  input: { fontSize: 15, maxHeight: 80 },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default GroupChatScreen;