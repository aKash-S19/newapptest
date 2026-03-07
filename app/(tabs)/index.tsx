import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG        = '#F4F6F8';
const CARD_BG   = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_SOFT = '#8FA3B1';
const ACCENT    = '#4CAF82';

// ─── Placeholder conversation data (no backend yet) ──────────────────────────
type Chat = { id: string; name: string; last: string; time: string; unread: number };
const MOCK_CHATS: Chat[] = [];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ChatsScreen() {
  const { user, sessionToken } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);

  // ── Realtime badge count ─────────────────────────────────────────────────
  const fetchPending = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'get-requests', sessionToken });
      setPendingCount((res.received ?? []).length);
    } catch { /* ignore */ }
  }, [sessionToken]);

  useEffect(() => {
    fetchPending();
    if (!user?.id) return;
    const channel = supabaseClient
      .channel(`home-badge:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` },
        () => fetchPending(),
      )
      .subscribe();
    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [user?.id, fetchPending]);

  const filtered = ([] as any[]);  // placeholder until real chats exist

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <View style={styles.headerRight}>
          <Pressable onPress={() => router.push('/requests')} style={styles.iconBtn} hitSlop={10}>
            <Text style={styles.iconEmoji}>📬</Text>
            {pendingCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/profile')} style={styles.avatarBtn} hitSlop={10}>
            <Text style={styles.avatarEmoji}>⚙️</Text>
          </Pressable>
        </View>
      </View>



      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Conversations or empty state ── */}
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Pressable
              style={styles.findBtn}
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/(tabs)/friends');
              }}
            >
              <Text style={styles.findBtnText}>Find Friends</Text>
            </Pressable>
          </View>
        ) : (
          filtered.map(chat => (
            <Pressable
              key={chat.id}
              style={({ pressed }) => [styles.chatRow, pressed && { opacity: 0.85 }]}
              onPress={() => Haptics.selectionAsync()}
            >
              <View style={styles.chatAvatar}>
                <Text style={styles.chatAvatarLetter}>{chat.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.chatBody}>
                <View style={styles.chatTop}>
                  <Text style={styles.chatName}>{chat.name}</Text>
                  <Text style={styles.chatTime}>{chat.time}</Text>
                </View>
                <View style={styles.chatBottom}>
                  <Text style={styles.chatLast} numberOfLines={1}>{chat.last}</Text>
                  {chat.unread > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{chat.unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>



    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop:    Platform.OS === 'android' ? 16 : 12,
    paddingBottom: 12,
    backgroundColor: BG,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  headerTitle: { fontSize: 30, fontWeight: '800', color: TEXT_DARK, letterSpacing: 0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBtn: { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconEmoji: { fontSize: 24, paddingBottom: 2 },
  badge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#FF5F6D', borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 2, borderColor: BG,
  },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  
  avatarBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(76,175,130,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(76,175,130,0.25)',
  },
  avatarEmoji: { fontSize: 16 },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 60, paddingTop: 16, gap: 10 },

  // Empty state
  emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: TEXT_SOFT },
  findBtn: {
    marginTop: 10, backgroundColor: ACCENT, borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  findBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Chat row
  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD_BG, borderRadius: 16, padding: 14,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.04)',
    ...Platform.select({
      web:     { boxShadow: '0px 2px 8px rgba(123,158,192,0.10)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
    }),
  },
  chatAvatar: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(76,175,130,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  chatAvatarLetter: { fontSize: 20, fontWeight: '700', color: ACCENT },
  chatBody:   { flex: 1, gap: 4 },
  chatTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName:   { fontSize: 15, fontWeight: '700', color: TEXT_DARK },
  chatTime:   { fontSize: 12, color: TEXT_SOFT },
  chatBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatLast:   { fontSize: 13, color: TEXT_SOFT, flex: 1 },
  unreadBadge:{ backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
  unreadText: { fontSize: 11, color: '#fff', fontWeight: '700' },
});

