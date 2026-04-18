import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator, Alert, Platform, Pressable,
    RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────
type ReqUser   = { id: string; username: string };
type Received  = { id: string; status: string; created_at: string; sender: ReqUser };
type Sent      = { id: string; status: string; created_at: string; receiver: ReqUser };
type GroupRequest = { 
  id: string; 
  group_id: string; 
  status: string; 
  created_at: string; 
  added_by: string;
  group: { id: string; name: string; description: string | null };
  user: ReqUser;
  added_by_user?: ReqUser;
  group_members?: { user: ReqUser }[];
};

const ERROR = '#FF5F6D';

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)  return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function RequestsScreen() {
  const th = useAppTheme();
  const { isTablet } = useLayout();
  const { sessionToken } = useAuth();
  const [activeTab, setActiveTab]     = useState<'received' | 'sent' | 'groups'>('received');
  const [received,  setReceived]      = useState<Received[]>([]);
  const [sent,      setSent]          = useState<Sent[]>([]);
  const [groupRequests, setGroupRequests] = useState<GroupRequest[]>([]);
  const [loading,   setLoading]       = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [acting,    setActing]        = useState<string | null>(null); // request id being processed

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetch = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const [friendRes, groupRes] = await Promise.all([
        callAuthFunction({ action: 'get-requests', sessionToken }),
        callAuthFunction({ action: 'get-group-requests', sessionToken }),
      ]);
      setReceived(friendRes.received ?? []);
      setSent(friendRes.sent ?? []);
      setGroupRequests((groupRes.groupRequests ?? []) as GroupRequest[]);
    } catch { /* no-op */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [sessionToken]);

  // ── Initial load + polling refresh ───────────────────────────────────────
  useEffect(() => {
    fetch();
    if (!sessionToken) return;
    const timer = setInterval(() => {
      fetch();
    }, 8000);
    return () => {
      clearInterval(timer);
    };
  }, [sessionToken, fetch]);

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

  const handleGroupAccept = async (requestId: string, groupId: string, targetUserId: string) => {
    if (!sessionToken) return;
    setActing(requestId);
    try {
      await callAuthFunction({ action: 'accept-group-request', sessionToken, requestId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'You have joined the group!');
      fetch();
    } catch {
      Alert.alert('Error', 'Could not accept invitation');
    }
    setActing(null);
  };

  const handleGroupDecline = async (requestId: string, groupId: string, targetUserId: string) => {
    if (!sessionToken) return;
    setActing(requestId);
    try {
      await callAuthFunction({ action: 'decline-group-request', sessionToken, requestId });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert('Removed', 'You have declined the group invitation.');
      fetch();
    } catch {
      Alert.alert('Error', 'Could not decline invitation');
    }
    setActing(null);
  };

  const handleGroupReport = async (requestId: string, groupId: string, reportedUserId: string, groupName: string) => {
    if (!sessionToken) return;
    Alert.alert(
      'Report User',
      `Are you sure you want to report this user for adding you to "${groupName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Report', 
          style: 'destructive',
          onPress: async () => {
            setActing(requestId);
            try {
              const res = await callAuthFunction({
                action: 'report-group-request',
                sessionToken,
                requestId,
                groupId,
                reportedUserId,
              });

              if (res?.banned) {
                Alert.alert('Report Submitted', 'User has been banned due to multiple reports.');
              } else {
                Alert.alert('Report Submitted', 'The user has been reported. Thank you!');
              }
              
              fetch();
            } catch {
              Alert.alert('Error', 'Could not submit report');
            }
            setActing(null);
          }
        }
      ]
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const onRefresh = () => { setRefreshing(true); fetch(); };

  const totalPending = received.length + sent.length + groupRequests.length;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: th.bg }]}>
      <View style={[{ flex: 1, width: '100%' }, isTablet && { maxWidth: 720, alignSelf: 'center' as const }]}>
      {/* ── Header ── */}
      <View style={[s.header, { backgroundColor: th.bg, borderBottomColor: th.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <Text style={[s.backIcon, { color: th.textDark }]}>←</Text>
        </Pressable>
        <Text style={[s.headerTitle, { color: th.textDark }]}>Requests</Text>
        <View style={s.headerBadgeBox}>
          {totalPending > 0 && (
            <View style={s.headerBadge}>
              <Text style={s.headerBadgeText}>{totalPending}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={s.tabBar}>
        {(['received', 'sent', 'groups'] as const).map(tab => (
          <Pressable
            key={tab}
            style={[
              s.tabBtn,
              { backgroundColor: th.inputBg },
              activeTab === tab && { backgroundColor: th.cardBg, borderWidth: 1.5, borderColor: th.accent + '30' },
            ]}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
          >
            <Text style={[
              s.tabText,
              { color: th.textMed },
              activeTab === tab && { color: th.accent, fontFamily: 'Inter_700Bold' },
            ]}>
              {tab === 'received'
                ? `Friends${received.length ? ` (${received.length})` : ''}`
                : tab === 'sent'
                ? `Sent${sent.length ? ` (${sent.length})` : ''}`
                : `Groups${groupRequests.length ? ` (${groupRequests.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={th.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={th.accent} />}
        >
          {activeTab === 'received' && (
            received.length === 0 ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyIcon}>📭</Text>
                <Text style={[s.emptyTitle, { color: th.textSoft }]}>No pending requests</Text>
              </View>
            ) : received.map(req => (
              <View key={req.id} style={[s.reqCard, { backgroundColor: th.cardBg, borderColor: th.border }]}>
                <View style={s.reqInfo}>
                  <View style={[s.reqAvatar, { backgroundColor: th.accent + '22' }]}>
                    <Text style={[s.reqAvatarLetter, { color: th.accent }]}>{req.sender.username[0].toUpperCase()}</Text>
                  </View>
                  <View style={s.reqMeta}>
                    <Text style={[s.reqName, { color: th.textDark }]}>{req.sender.username}</Text>
                    <Text style={[s.reqTime, { color: th.textSoft }]}>{timeAgo(req.created_at)}</Text>
                  </View>
                </View>
                <View style={s.reqActions}>
                  <Pressable
                    style={[s.actionBtnAccept, { backgroundColor: th.accent }, acting === req.id && s.btnDisabled]}
                    onPress={() => handleAccept(req.id)} disabled={acting === req.id}>
                    {acting === req.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={s.actionTextAccept}>Accept</Text>}
                  </Pressable>
                  <Pressable
                    style={[s.actionBtnDecline, acting === req.id && s.btnDisabled]}
                    onPress={() => handleDecline(req.id)} disabled={acting === req.id}>
                    <Text style={s.actionTextDecline}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {activeTab === 'sent' && (
            sent.length === 0 ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyIcon}>📤</Text>
                <Text style={[s.emptyTitle, { color: th.textSoft }]}>No sent requests</Text>
              </View>
            ) : sent.map(req => (
              <View key={req.id} style={[s.reqCard, { backgroundColor: th.cardBg, borderColor: th.border }]}>
                <View style={s.reqInfo}>
                  <View style={[s.reqAvatar, { backgroundColor: th.accent + '22' }]}>
                    <Text style={[s.reqAvatarLetter, { color: th.accent }]}>{req.receiver.username[0].toUpperCase()}</Text>
                  </View>
                  <View style={s.reqMeta}>
                    <Text style={[s.reqName, { color: th.textDark }]}>{req.receiver.username}</Text>
                    <Text style={[s.reqTime, { color: th.textSoft }]}>{timeAgo(req.created_at)}</Text>
                  </View>
                </View>
                <Pressable
                  style={[s.actionBtnCancel, { backgroundColor: th.inputBg }, acting === req.id && s.btnDisabled]}
                  onPress={() => handleCancel(req.id)} disabled={acting === req.id}>
                  {acting === req.id
                    ? <ActivityIndicator size="small" color={th.textMed} />
                    : <Text style={[s.actionTextCancel, { color: th.textMed }]}>Cancel</Text>}
                </Pressable>
              </View>
            ))
          )}

          {activeTab === 'groups' && (
            groupRequests.length === 0 ? (
              <View style={s.emptyWrap}>
                <MaterialCommunityIcons name="account-group-outline" size={48} color={th.textSoft} />
                <Text style={[s.emptyTitle, { color: th.textSoft }]}>No group invitations</Text>
              </View>
            ) : groupRequests.map(req => {
              const memberNames = req.group_members?.map(m => m.user.username).join(', ') || 'No other members';
              return (
                <View key={req.id} style={[s.reqCard, { backgroundColor: th.cardBg, borderColor: th.border }]}>
                  {/* Group Info */}
                  <View style={s.reqInfo}>
                    <View style={[s.reqAvatar, { backgroundColor: th.accent + '22' }]}>
                      <MaterialCommunityIcons name="account-group" size={20} color={th.accent} />
                    </View>
                    <View style={s.reqMeta}>
                      <Text style={[s.reqName, { color: th.textDark }]}>{req.group?.name || 'Group'}</Text>
                      <Text style={[s.reqTime, { color: th.textSoft }]}>
                        Added by: {req.added_by_user?.username || 'Unknown'}
                      </Text>
                    </View>
                  </View>
                  
                  {/* Members */}
                  <View style={[s.groupMembersInfo, { borderTopColor: th.divider }]}>
                    <Text style={[s.groupMembersLabel, { color: th.textSoft }]}>Current members:</Text>
                    <Text style={[s.groupMembersText, { color: th.textMed }]}>{memberNames}</Text>
                  </View>
                  
                  {/* Actions */}
                  <View style={s.reqActions}>
                    <Pressable
                      style={[s.actionBtnAccept, { backgroundColor: th.accent, flex: 1 }, acting === req.id && s.btnDisabled]}
                      onPress={() => handleGroupAccept(req.id, req.group_id, req.user.id)} disabled={acting === req.id}>
                      {acting === req.id
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={s.actionTextAccept}>✓ Accept</Text>}
                    </Pressable>
                    <Pressable
                      style={[s.actionBtnCancel, { backgroundColor: th.inputBg, flex: 1 }, acting === req.id && s.btnDisabled]}
                      onPress={() => handleGroupDecline(req.id, req.group_id, req.user.id)} disabled={acting === req.id}>
                      <Text style={[s.actionTextCancel, { color: th.textMed }]}>✕ Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtnReport, { backgroundColor: ERROR + '20', flex: 1 }, acting === req.id && s.btnDisabled]}
                      onPress={() => handleGroupReport(req.id, req.group_id, req.added_by || req.user.id, req.group?.name || 'Group')} disabled={acting === req.id}>
                      <Text style={[s.actionTextReport, { color: ERROR }]}>⚠ Report</Text>
                    </Pressable>
                  </View>
                </View>
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
  safe:    { flex: 1 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 16 : 12, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn:  { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 24 },
  headerTitle:     { fontSize: 22, fontFamily: 'Inter_700Bold' },
  headerBadgeBox:  { width: 40, alignItems: 'flex-end' },
  headerBadge: {
    backgroundColor: ERROR, borderRadius: 10, minWidth: 22, height: 22,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  headerBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },

  tabBar: { flexDirection: 'row', padding: 12, gap: 10 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 12 },
  tabText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_500Medium' },

  reqCard: {
    borderRadius: 16, padding: 14, gap: 12, borderWidth: 1,
  },
  reqInfo:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqAvatar:       { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  reqAvatarLetter: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  reqMeta:         { flex: 1 },
  reqName:         { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  reqTime:         { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  reqActions:        { flexDirection: 'row', gap: 10 },
  actionBtnAccept:   { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  actionTextAccept:  { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  actionBtnDecline:  { flex: 1, backgroundColor: '#FEF0F1', paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  actionTextDecline: { color: ERROR, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  actionBtnCancel:   { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignSelf: 'flex-start' },
  actionTextCancel:  { fontSize: 14, fontFamily: 'Inter_500Medium' },
  btnDisabled:       { opacity: 0.6 },
  actionBtnReport:   { paddingVertical: 11, borderRadius: 12, alignItems: 'center', marginLeft: 8 },
  actionTextReport: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  groupMembersInfo:  { paddingTop: 12, marginTop: 12, borderTopWidth: 1 },
  groupMembersLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  groupMembersText:  { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
