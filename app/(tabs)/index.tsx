import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRow, useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { decryptMessage, getSharedKey } from '@/lib/e2ee';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

const AVATAR_COLORS = ['#4CAF82','#5C9BD6','#F4A261','#E76F51','#8B5CF6','#EC4899','#14B8A6'];
function avatarColor(username: string) {
  return AVATAR_COLORS[username.charCodeAt(0) % AVATAR_COLORS.length];
}
function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export default function ChatsScreen() {
  const th = useAppTheme();
  const { isTablet } = useLayout();
  const { user, sessionToken, getChats, deleteChat } = useAuth();
  const [chats,             setChats]            = useState<ChatRow[]>([]);
  const [pendingCount,      setPendingCount]      = useState(0);
  const [loading,           setLoading]           = useState(true);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, string>>({});
  const channelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);

  const fetchChats = useCallback(async () => {
    try { setChats(await getChats()); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [getChats]);

  const fetchPending = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'get-requests', sessionToken });
      setPendingCount((res.received ?? []).length);
    } catch { /* ignore */ }
  }, [sessionToken]);

  const handleDeleteChat = useCallback((chatId: string, peerName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Chat',
      `Delete your conversation with ${peerName}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChat(chatId);
              setChats(prev => prev.filter(c => c.chat_id !== chatId));
            } catch {
              Alert.alert('Error', 'Could not delete chat. Please try again.');
            }
          },
        },
      ],
    );
  }, [deleteChat]);

  // Re-fetch pending count every time this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchPending();
    }, [fetchPending]),
  );

  // Decrypt last-message previews whenever chats list changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const previews: Record<string, string> = {};
      for (const chat of chats) {
        if (!chat.last_message || !chat.peer_public_key) continue;
        try {
          const key = await getSharedKey(chat.user.id, chat.peer_public_key);
          const raw = await decryptMessage(key, chat.last_message.encrypted_body);
          if (chat.last_message.msg_type === 'text') {
            previews[chat.chat_id] = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
          } else if (chat.last_message.msg_type === 'image') {
            previews[chat.chat_id] = '📷 Photo';
          } else if (chat.last_message.msg_type === 'voice') {
            previews[chat.chat_id] = '🎤 Voice message';
          } else if (chat.last_message.msg_type === 'video') {
            previews[chat.chat_id] = '🎬 Video';
          } else {
            previews[chat.chat_id] = '📎 File';
          }
        } catch {
          previews[chat.chat_id] = '🔒 Encrypted message';
        }
      }
      if (!cancelled) setDecryptedPreviews(previews);
    })();
    return () => { cancelled = true; };
  }, [chats]);

  useEffect(() => {
    fetchChats();
    fetchPending();
    if (!user?.id) return;
    const channel = supabaseClient
      .channel(`home:${user.id}`)
      // No filter — anon key can't receive filtered realtime with service_role-only RLS
      // We just use the event as a nudge to re-fetch
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => fetchPending())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_members' }, () => fetchChats())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_members' }, () => fetchChats())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => fetchChats())
      .subscribe();
    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [user?.id, fetchChats, fetchPending]);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: th.bg }]}>
      <View style={[{ flex: 1, width: '100%' }, isTablet && { maxWidth: 720, alignSelf: 'center' }]}>

      {/* ── Header ── */}
      <View style={[s.header, { borderBottomColor: th.divider }]}>
        <Text style={[s.headerTitle, { color: th.textDark }]}>Messages</Text>
        <View style={s.headerActions}>
          {/* Requests bell */}
          <Pressable onPress={() => router.push('/requests')} style={s.iconBtn} hitSlop={12}>
            <MaterialCommunityIcons
              name="bell-outline"
              size={24}
              color={pendingCount > 0 ? th.accent : th.textSoft}
            />
            {pendingCount > 0 && (
              <View style={[s.badge, { borderColor: th.bg }]}>
                <Text style={s.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
              </View>
            )}
          </Pressable>
          {/* Settings */}
          <Pressable
            onPress={() => router.push('/profile')}
            style={[s.settingsBtn, { backgroundColor: th.inputBg }]}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="cog-outline" size={20} color={th.textMed} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={th.accent} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {chats.length === 0 ? (
            <View style={s.emptyWrap}>
              <View style={[s.emptyIconBg, { backgroundColor: th.accent + '15' }]}>
                <MaterialCommunityIcons name="message-text-outline" size={40} color={th.accent} />
              </View>
              <Text style={[s.emptyTitle, { color: th.textDark }]}>No messages yet</Text>
              <Text style={[s.emptyHint,  { color: th.textSoft }]}>Add friends to start a secure, end-to-end encrypted chat</Text>
              <Pressable
                style={[s.findBtn, { backgroundColor: th.accent }]}
                onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/friends'); }}
              >
                <MaterialCommunityIcons name="account-plus-outline" size={16} color="#fff" />
                <Text style={s.findBtnText}>Find Friends</Text>
              </Pressable>
            </View>
          ) : (
            chats.map(chat => {
              const ac       = avatarColor(chat.user.username);
              const preview  = decryptedPreviews[chat.chat_id];
              const hasUnread = chat.unread_count > 0;
              const timestamp = chat.last_message_at ?? chat.joined_at;
              const isMine   = chat.last_message?.sender_id === user?.id;
              return (
                <Pressable
                  key={chat.chat_id}
                  style={({ pressed }) => [s.chatRow, { backgroundColor: th.cardBg }, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    // Immediately clear the unread badge — don't wait for markRead round-trip
                    setChats(prev =>
                      prev.map(c =>
                        c.chat_id === chat.chat_id ? { ...c, unread_count: 0 } : c,
                      ),
                    );
                    router.push({
                      pathname: '/chat/[id]',
                      params: {
                        id:          chat.chat_id,
                        peerId:      chat.user.id,
                        peerName:    chat.user.username,
                        peerAvatar:  chat.user.avatar_url ?? '',
                        peerKey:     chat.peer_public_key ?? '',
                      },
                    });
                  }}
                  onLongPress={() => handleDeleteChat(chat.chat_id, chat.user.username)}
                  delayLongPress={400}
                >
                  {chat.user.avatar_url ? (
                    <Image
                      source={{ uri: chat.user.avatar_url }}
                      style={s.chatAvatar}
                    />
                  ) : (
                    <View style={[s.chatAvatar, { backgroundColor: ac + '20' }]}>
                      <Text style={[s.chatAvatarLetter, { color: ac }]}>
                        {chat.user.username[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={s.chatBody}>
                    <View style={s.chatTop}>
                      <Text style={[s.chatName, { color: th.textDark, fontFamily: hasUnread ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}>{chat.user.username}</Text>
                      <Text style={[s.chatTime, { color: hasUnread ? th.accent : th.textSoft }]}>{timeAgo(timestamp)}</Text>
                    </View>
                    <View style={s.chatLastRow}>
                      {isMine && chat.last_message && (
                        <MaterialCommunityIcons
                          name={chat.last_message.status === 'read' ? 'check-all' : chat.last_message.status === 'delivered' ? 'check-all' : 'check'}
                          size={13}
                          color={chat.last_message.status === 'read' ? th.accent : th.textSoft}
                          style={{ marginTop: 1 }}
                        />
                      )}
                      {preview ? (
                        <Text style={[s.chatLast, { color: hasUnread ? th.textDark : th.textSoft, fontFamily: hasUnread ? 'Inter_600SemiBold' : 'Inter_400Regular' }]} numberOfLines={1}>
                          {preview}
                        </Text>
                      ) : (
                        <>
                          <MaterialCommunityIcons name="lock-outline" size={12} color={th.textSoft} style={{ marginTop: 1 }} />
                          <Text style={[s.chatLast, { color: th.textSoft }]}>End-to-end encrypted</Text>
                        </>
                      )}
                    </View>
                  </View>
                  {hasUnread ? (
                    <View style={[s.unreadBadge, { backgroundColor: th.accent }]}>
                      <Text style={s.unreadText}>{chat.unread_count > 99 ? '99+' : chat.unread_count}</Text>
                    </View>
                  ) : (
                    <MaterialCommunityIcons name="chevron-right" size={18} color={th.border} />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 8 : 4,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle:   { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: '#FF5F6D', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5,
  },
  badgeText: { color: '#FFF', fontSize: 9, fontFamily: 'Inter_700Bold' },

  settingsBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  scrollContent: { paddingBottom: 24 },

  emptyWrap:    { alignItems: 'center', paddingTop: 72, paddingHorizontal: 40, gap: 12 },
  emptyIconBg:  { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:   { fontSize: 18, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.2 },
  emptyHint:    { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  findBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 11 },
  findBtnText:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  chatAvatar:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  chatAvatarLetter: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  chatBody:  { flex: 1, gap: 3 },
  chatTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName:  { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.1 },
  chatTime:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  chatLastRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chatLast:  { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText:  { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },
});

