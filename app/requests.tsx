import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────
type ReqUser   = { id: string; username: string };
type Received  = { id: string; status: string; created_at: string; sender: ReqUser };
type Sent      = { id: string; status: string; created_at: string; receiver: ReqUser };

// ─── Theme ───────────────────────────────────────────────────────────────────
const BG        = '#F4F6F8';
const CARD_BG   = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_SOFT = '#8FA3B1';
const TEXT_MED  = '#5A7182';
const ACCENT    = '#4CAF82';
const ERROR     = '#FF5F6D';

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)  return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function RequestsScreen() {
  const { sessionToken, user } = useAuth();
  const [activeTab, setActiveTab]     = useState<'received' | 'sent'>('received');
  const [received,  setReceived]      = useState<Received[]>([]);
  const [sent,      setSent]          = useState<Sent[]>([]);
  const [loading,   setLoading]       = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [acting,    setActing]        = useState<string | null>(null); // request id being processed
  const channelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetch = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'get-requests', sessionToken });
      setReceived(res.received ?? []);
      setSent(res.sent ?? []);
    } catch { /* no-op */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [sessionToken]);

  // ── Initial load + realtime subscription ─────────────────────────────────
  useEffect(() => {
    fetch();

    // Subscribe to changes on friend_requests table for this user
    if (!user?.id) return;
    const channel = supabaseClient
      .channel(`requests:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests',
          filter: `receiver_id=eq.${user.id}` },
        () => fetch(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests',
          filter: `sender_id=eq.${user.id}` },
        () => fetch(),
      )
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [user?.id, fetch]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const act = useCallback(async (
    requestId: string,
    action: string,
    hapticOk: () => void,
  ) => {
    if (!sessionToken) return;
    setActing(requestId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await callAuthFunction({ action, sessionToken, requestId });
      hapticOk();
      fetch(); // immediate optimistic refresh
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setActing(null); }
  }, [sessionToken, fetch]);

  const handleAccept  = (id: string) => act(id, 'accept-request',  () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  const handleDecline = (id: string) => act(id, 'decline-request', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  const handleCancel  = (id: string) => act(id, 'cancel-request',  () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

  // ── Render ───────────────────────────────────────────────────────────────
  const onRefresh = () => { setRefreshing(true); fetch(); };

  const totalPending = received.length + sent.length;

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Requests</Text>
        <View style={styles.headerBadgeBox}>
          {totalPending > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalPending}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        {(['received', 'sent'] as const).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'received' ? `Received${received.length ? ` (${received.length})` : ''}` : `Sent${sent.length ? ` (${sent.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        >
          {activeTab === 'received' && (
            received.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>📭</Text>
                <Text style={styles.emptyTitle}>No pending requests</Text>
              </View>
            ) : received.map(req => (
              <View key={req.id} style={styles.reqCard}>
                <View style={styles.reqInfo}>
                  <View style={styles.reqAvatar}>
                    <Text style={styles.reqAvatarLetter}>{req.sender.username[0].toUpperCase()}</Text>
                  </View>
                  <View style={styles.reqMeta}>
                    <Text style={styles.reqName}>{req.sender.username}</Text>
                    <Text style={styles.reqTime}>{timeAgo(req.created_at)}</Text>
                  </View>
                </View>
                <View style={styles.reqActions}>
                  <Pressable
                    style={[styles.actionBtnAccept, acting === req.id && styles.btnDisabled]}
                    onPress={() => handleAccept(req.id)} disabled={acting === req.id}>
                    {acting === req.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.actionTextAccept}>Accept</Text>}
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtnDecline, acting === req.id && styles.btnDisabled]}
                    onPress={() => handleDecline(req.id)} disabled={acting === req.id}>
                    <Text style={styles.actionTextDecline}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {activeTab === 'sent' && (
            sent.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>📤</Text>
                <Text style={styles.emptyTitle}>No sent requests</Text>
              </View>
            ) : sent.map(req => (
              <View key={req.id} style={styles.reqCard}>
                <View style={styles.reqInfo}>
                  <View style={styles.reqAvatar}>
                    <Text style={styles.reqAvatarLetter}>{req.receiver.username[0].toUpperCase()}</Text>
                  </View>
                  <View style={styles.reqMeta}>
                    <Text style={styles.reqName}>{req.receiver.username}</Text>
                    <Text style={styles.reqTime}>{timeAgo(req.created_at)}</Text>
                  </View>
                </View>
                <Pressable
                  style={[styles.actionBtnCancel, acting === req.id && styles.btnDisabled]}
                  onPress={() => handleCancel(req.id)} disabled={acting === req.id}>
                  {acting === req.id
                    ? <ActivityIndicator size="small" color={TEXT_MED} />
                    : <Text style={styles.actionTextCancel}>Cancel</Text>}
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 16 : 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)', backgroundColor: BG,
  },
  backBtn:  { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 24, color: TEXT_DARK },
  headerTitle: { fontSize: 22, fontWeight: '800', color: TEXT_DARK },
  headerBadgeBox: { width: 40, alignItems: 'flex-end' },
  headerBadge: {
    backgroundColor: ERROR, borderRadius: 10, minWidth: 22, height: 22,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  headerBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  tabBar: { flexDirection: 'row', padding: 12, gap: 10 },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 12, backgroundColor: '#E4E9F0',
  },
  tabBtnActive: {
    backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: 'rgba(76,175,130,0.2)',
  },
  tabText:       { fontSize: 14, fontWeight: '600', color: TEXT_MED },
  tabTextActive: { color: ACCENT, fontWeight: '700' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  emptyWrap:   { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyIcon:   { fontSize: 48 },
  emptyTitle:  { fontSize: 18, fontWeight: '600', color: TEXT_SOFT },

  reqCard: {
    backgroundColor: CARD_BG, borderRadius: 16, padding: 14, gap: 12,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)',
    ...Platform.select({
      web:     { boxShadow: '0px 2px 8px rgba(123,158,192,0.08)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
    }),
  },
  reqInfo:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqAvatar:      { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(76,175,130,0.15)', alignItems: 'center', justifyContent: 'center' },
  reqAvatarLetter:{ fontSize: 18, fontWeight: '700', color: ACCENT },
  reqMeta:        { flex: 1 },
  reqName:        { fontSize: 16, fontWeight: '700', color: TEXT_DARK },
  reqTime:        { fontSize: 13, color: TEXT_SOFT, marginTop: 2 },

  reqActions:        { flexDirection: 'row', gap: 10 },
  actionBtnAccept:   { flex: 1, backgroundColor: ACCENT,    paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  actionTextAccept:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionBtnDecline:  { flex: 1, backgroundColor: '#FEF0F1', paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  actionTextDecline: { color: ERROR, fontSize: 14, fontWeight: '700' },
  actionBtnCancel:   { backgroundColor: '#EDF0F4', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignSelf: 'flex-start' },
  actionTextCancel:  { color: TEXT_MED, fontSize: 14, fontWeight: '600' },
  btnDisabled:       { opacity: 0.6 },
});
