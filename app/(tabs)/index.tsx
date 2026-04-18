import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRow, useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { decryptMessage, getSharedKey } from '@/lib/e2ee';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction } from '@/lib/supabase';

const AVATAR_COLORS = ['#4CAF82','#5C9BD6','#F4A261','#E76F51','#8B5CF6','#EC4899','#14B8A6'];
const CHAT_COLOR_SWATCHES = ['#FFFFFF', '#111827', '#4CAF82', '#5C9BD6', '#F4A261', '#E76F51', '#8B5CF6', '#EC4899', '#14B8A6'];
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

function normalizeHex(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.8;
}

export default function ChatsScreen() {
  const th = useAppTheme();
  const { isTablet } = useLayout();
  const { user, sessionToken, getChats, deleteChat } = useAuth();
  const { settings, update } = useSettings();
  const [chats,             setChats]            = useState<ChatRow[]>([]);
  const [searchQuery,       setSearchQuery]      = useState('');
  const [pendingCount,      setPendingCount]      = useState(0);
  const [loading,           setLoading]           = useState(true);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, string>>({});
  const [actionChat,        setActionChat]        = useState<ChatRow | null>(null);
  const [showActions,       setShowActions]       = useState(false);
  const [showCustomize,     setShowCustomize]     = useState(false);
  const [customNickname,    setCustomNickname]    = useState('');
  const [customColor,       setCustomColor]       = useState('');
  const [customColorInput,  setCustomColorInput]  = useState('');
  const [showSearch,        setShowSearch]        = useState(false);

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

  const customizations = settings.chatCustomizations ?? {};

  const openCustomize = useCallback((chat: ChatRow) => {
    const current = customizations[chat.chat_id];
    setCustomNickname(current?.nickname ?? '');
    setCustomColor(current?.color ?? '');
    setCustomColorInput(current?.color ?? '');
    setActionChat(chat);
    setShowCustomize(true);
  }, [customizations]);

  const saveCustomize = useCallback(() => {
    if (!actionChat) return;
    const nick = customNickname.trim();
    const colorRaw = customColorInput.trim() || customColor.trim();
    const color = colorRaw ? normalizeHex(colorRaw) : null;
    if (colorRaw && !color) {
      Alert.alert('Invalid color', 'Use a 6-digit hex color like #A1B2C3.');
      return;
    }
    const next = { ...customizations };
    if (!nick && !color) {
      delete next[actionChat.chat_id];
    } else {
      next[actionChat.chat_id] = { ...(nick ? { nickname: nick } : {}), ...(color ? { color } : {}) };
    }
    update('chatCustomizations', next);
    setShowCustomize(false);
  }, [actionChat, customNickname, customColor, customColorInput, customizations, update]);

  const clearCustomize = useCallback(() => {
    if (!actionChat) return;
    const next = { ...customizations };
    delete next[actionChat.chat_id];
    update('chatCustomizations', next);
    setShowCustomize(false);
  }, [actionChat, customizations, update]);

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
      fetchChats();
      fetchPending();
    }, [fetchChats, fetchPending]),
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
    if (!sessionToken) return;
    const timer = setInterval(() => {
      fetchChats();
      fetchPending();
    }, 7000);
    return () => {
      clearInterval(timer);
    };
  }, [sessionToken, fetchChats, fetchPending]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredChats = chats.filter(chat => {
    if (!normalizedQuery) return true;
    const name = chat.user.username.toLowerCase();
    const nick = customizations[chat.chat_id]?.nickname?.toLowerCase() ?? '';
    const preview = (decryptedPreviews[chat.chat_id] ?? '').toLowerCase();
    return name.includes(normalizedQuery) || nick.includes(normalizedQuery) || preview.includes(normalizedQuery);
  });

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: th.bg }]}>
      <View style={[{ flex: 1, width: '100%' }, isTablet && { maxWidth: 720, alignSelf: 'center' }]}>

      {/* ── Header ── */}
      <View style={[s.header, { borderBottomColor: th.divider }]}>
        <Text style={[s.headerTitle, { color: th.textDark }]}>Messages</Text>
        <View style={s.headerActions}>
          {/* Search */}
          <Pressable
            onPress={() => setShowSearch(true)}
            style={[s.settingsBtn, { backgroundColor: th.inputBg }]}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={th.textMed} />
          </Pressable>
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
          ) : filteredChats.length === 0 ? (
            <View style={s.emptySearch}>
              <Text style={[s.emptySearchTitle, { color: th.textDark }]}>No matches</Text>
              <Text style={[s.emptySearchHint, { color: th.textSoft }]}>Try a different name or keyword.</Text>
            </View>
          ) : (
            filteredChats.map(chat => {
              const ac       = avatarColor(chat.user.username);
              const custom   = customizations[chat.chat_id];
              const nickname = custom?.nickname?.trim();
              const chatColor = custom?.color?.trim();
              const preview  = decryptedPreviews[chat.chat_id];
              const hasUnread = chat.unread_count > 0;
              const timestamp = chat.last_message_at ?? chat.joined_at;
              const isMine   = chat.last_message?.sender_id === user?.id;
              return (
                <Pressable
                  key={chat.chat_id}
                  style={({ pressed }) => [
                    s.chatRow,
                    {
                      backgroundColor: th.cardBg,
                      borderLeftColor: chatColor ?? 'transparent',
                      borderLeftWidth: chatColor ? 4 : 0,
                      paddingLeft: chatColor ? 16 : 20,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
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
                  onLongPress={() => { setActionChat(chat); setShowActions(true); }}
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
                      <Text style={[s.chatName, { color: th.textDark, fontFamily: hasUnread ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}
                        numberOfLines={1}
                      >
                        {nickname || chat.user.username}
                        {nickname && (
                          <Text style={[s.chatNameSecondary, { color: th.textSoft }]}> · {chat.user.username}</Text>
                        )}
                      </Text>
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

      {/* Action sheet */}
      {showActions && actionChat && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowActions(false)}>
            <Pressable style={[s.sheet, { backgroundColor: th.cardBg }]}>
              <Pressable style={s.sheetItem} onPress={() => { setShowActions(false); openCustomize(actionChat); }}>
                <MaterialCommunityIcons name="palette-outline" size={20} color={th.textDark} />
                <Text style={[s.sheetText, { color: th.textDark }]}>Customize</Text>
              </Pressable>
              <Pressable style={s.sheetItem} onPress={() => { setShowActions(false); handleDeleteChat(actionChat.chat_id, actionChat.user.username); }}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color="#EF4444" />
                <Text style={[s.sheetText, { color: '#EF4444' }]}>Delete chat</Text>
              </Pressable>
              <Pressable style={[s.sheetItem, s.sheetCancel]} onPress={() => setShowActions(false)}>
                <Text style={[s.sheetText, { color: th.textSoft }]}>Cancel</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Customize modal */}
      {showCustomize && actionChat && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowCustomize(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowCustomize(false)}>
            <Pressable style={[s.customSheet, { backgroundColor: th.cardBg }]}>
              <Text style={[s.customTitle, { color: th.textDark }]}>Customize chat</Text>
              <Text style={[s.customLabel, { color: th.textSoft }]}>Nickname</Text>
              <TextInput
                style={[s.customInput, { backgroundColor: th.inputBg, color: th.textDark, borderColor: th.divider }]}
                placeholder="Add a nickname (optional)"
                placeholderTextColor={th.textSoft}
                value={customNickname}
                onChangeText={setCustomNickname}
                maxLength={40}
              />
              <Text style={[s.customLabel, { color: th.textSoft }]}>Chat color</Text>
              <View style={s.swatchRow}>
                {CHAT_COLOR_SWATCHES.map(color => (
                  <Pressable
                    key={color}
                    style={[
                      s.swatch,
                      { backgroundColor: color, borderColor: isLightColor(color) ? th.divider : 'transparent' },
                      customColor.toUpperCase() === color ? s.swatchSelected : null,
                    ]}
                    onPress={() => { setCustomColor(color); setCustomColorInput(color); }}
                  />
                ))}
              </View>
              <TextInput
                style={[s.customInput, { backgroundColor: th.inputBg, color: th.textDark, borderColor: th.divider }]}
                placeholder="#A1B2C3"
                placeholderTextColor={th.textSoft}
                value={customColorInput}
                onChangeText={setCustomColorInput}
                autoCapitalize="characters"
                maxLength={7}
              />
              <View style={s.customActions}>
                <Pressable style={[s.customBtn, { backgroundColor: th.inputBg }]} onPress={clearCustomize}>
                  <Text style={[s.customBtnText, { color: th.textSoft }]}>Clear</Text>
                </Pressable>
                <Pressable style={[s.customBtn, { backgroundColor: th.accent }]} onPress={saveCustomize}>
                  <Text style={[s.customBtnText, { color: '#fff' }]}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Search modal */}
      {showSearch && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowSearch(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowSearch(false)}>
            <Pressable style={[s.searchSheet, { backgroundColor: th.cardBg }]}>
              <Text style={[s.searchTitle, { color: th.textDark }]}>Search chats</Text>
              <View style={[s.searchWrap, { backgroundColor: th.inputBg, borderColor: th.divider }]}> 
                <MaterialCommunityIcons name="magnify" size={18} color={th.textSoft} />
                <TextInput
                  style={[s.searchInput, { color: th.textDark }]}
                  placeholder="Search messages"
                  placeholderTextColor={th.textSoft}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                  autoFocus
                />
              </View>
              <Pressable style={[s.customBtn, { alignSelf: 'flex-end', backgroundColor: th.inputBg }]} onPress={() => { setSearchQuery(''); setShowSearch(false); }}>
                <Text style={[s.customBtnText, { color: th.textSoft }]}>Close</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
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

  scrollContent: { paddingHorizontal: 18, paddingBottom: 24, gap: 12 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  searchSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  searchTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },

  emptyWrap:    { alignItems: 'center', paddingTop: 72, paddingHorizontal: 40, gap: 12 },
  emptyIconBg:  { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:   { fontSize: 18, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.2 },
  emptyHint:    { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  findBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 11 },
  findBtnText:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  emptySearch: { alignItems: 'center', paddingVertical: 28, gap: 6 },
  emptySearchTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptySearchHint: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  chatAvatar:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  chatAvatarLetter: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  chatBody:  { flex: 1, gap: 3 },
  chatTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName:  { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.1 },
  chatNameSecondary: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  chatTime:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  chatLastRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chatLast:  { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText:  { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingVertical: 10 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 20 },
  sheetText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  sheetCancel: { justifyContent: 'center' },

  customSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  customTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  customLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 6 },
  customInput: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
  swatchSelected: { borderWidth: 2, borderColor: '#111827' },
  customActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  customBtn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  customBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});

