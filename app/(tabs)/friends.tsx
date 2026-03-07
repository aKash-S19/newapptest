import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, UserInfo } from '@/contexts/AuthContext';
import { AppTheme, useAppTheme } from '@/hooks/use-app-theme';
import { useLayout } from '@/lib/responsive';

// ─── Avatar colours (deterministic from first char) ──────────────────────────
const AVATAR_COLORS = ['#4CAF82','#5C9BD6','#F4A261','#E76F51','#8B5CF6','#EC4899','#14B8A6'];
function avatarColor(username: string) {
  return AVATAR_COLORS[username.charCodeAt(0) % AVATAR_COLORS.length];
}
function joinYear(created_at: string) {
  return new Date(created_at).getFullYear();
}

// ─── Request button states ────────────────────────────────────────────────────
type BtnState = 'none' | 'sending' | 'sent' | 'friends' | 'received';

// ─── Result card ──────────────────────────────────────────────────────────────
function UserCard({
  user,
  onAdd,
  onMessage,
  onRemove,
  th,
}: {
  user: UserInfo;
  onAdd: (id: string) => Promise<void>;
  onMessage: (peerId: string, chatId: string | null | undefined, peerName: string, peerAvatar: string | null | undefined, knownKey: string | null | undefined) => Promise<void>;
  onRemove: (peerId: string, username: string) => void;
  th: AppTheme;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const bg    = avatarColor(user.username);

  const initialState: BtnState =
    user.requestStatus === 'sent'     ? 'sent'    :
    user.requestStatus === 'friends'  ? 'friends' :
    user.requestStatus === 'received' ? 'received': 'none';

  const [btnState,    setBtnState]    = useState<BtnState>(initialState);
  const [messaging,  setMessaging]   = useState(false);

  const onIn  = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30, bounciness: 12 }).start();

  const handleAdd = async () => {
    if (btnState !== 'none') return;
    setBtnState('sending');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await onAdd(user.id);
      setBtnState('sent');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setBtnState('none');
      Alert.alert('Error', e.message ?? 'Could not send request');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleMessage = async () => {
    if (messaging) return;
    setMessaging(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onMessage(user.id, user.chatId, user.username, user.avatar_url, user.peerPublicKey);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not open chat');
    } finally {
      setMessaging(false);
    }
  };

  const renderButton = () => {
    switch (btnState) {
      case 'sending':
        return (
          <View style={[s.btn, { backgroundColor: th.inputBg }]}>
            <ActivityIndicator size="small" color={th.textMed} />
          </View>
        );
      case 'sent':
        return <View style={[s.btn, { backgroundColor: th.inputBg }]}><Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: th.textMed }}>Sent</Text></View>;
      case 'friends':
        return (
          <Pressable
            style={[s.btn, { backgroundColor: th.accent, opacity: messaging ? 0.6 : 1 }]}
            onPress={handleMessage}
            disabled={messaging}
          >
            {messaging
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <MaterialCommunityIcons name="message-outline" size={14} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Message</Text>
                </>
            }
          </Pressable>
        );
      case 'received':
        return (
          <Pressable style={[s.btn, { backgroundColor: th.accent + '15', borderWidth: 1, borderColor: th.accent + '30' }]} onPress={() => router.push('/requests')}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: th.accent }}>Respond</Text>
          </Pressable>
        );
      default:
        return (
          <Pressable style={[s.btn, { backgroundColor: th.accent, }]} onPress={handleAdd}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Add</Text>
          </Pressable>
        );
    }
  };

  return (
    <Animated.View style={[s.card, { backgroundColor: th.cardBg }, { transform: [{ scale }] }]}>
      <Pressable
        style={s.cardInner}
        onPressIn={onIn}
        onPressOut={onOut}
        onLongPress={btnState === 'friends' ? () => onRemove(user.id, user.username) : undefined}
        delayLongPress={500}
      >
        <View style={[s.avatar, { backgroundColor: bg + '20' }]}>
          <Text style={[s.avatarLetter, { color: bg }]}>{user.username[0].toUpperCase()}</Text>
        </View>
        <View style={s.cardInfo}>
          <Text style={[s.cardUsername, { color: th.textDark }]}>{user.username}</Text>
          <Text style={[s.cardMeta, { color: th.textSoft }]}>Joined {joinYear(user.created_at)}</Text>
        </View>
        {renderButton()}
      </Pressable>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function FriendsScreen() {
  const th = useAppTheme();
  const { isTablet } = useLayout();
  const { findUser, sendFriendRequest, openChat, removeFriend } = useAuth();
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<UserInfo[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { setResults(await findUser(trimmed)); setSearched(true); }
      catch { setResults([]); }
      finally { setLoading(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [query, findUser]);

  const clearSearch = useCallback(() => { setQuery(''); setResults([]); setSearched(false); }, []);

  const handleRemove = useCallback((peerId: string, username: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Remove Friend',
      `Remove ${username} from your friends? You can still send them a new request later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFriend(peerId);
              // Remove from results list
              setResults(prev => prev.filter(u => u.id !== peerId));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not remove friend');
            }
          },
        },
      ],
    );
  }, [removeFriend]);

  const handleMessage = useCallback(async (
    peerId: string,
    existingChatId: string | null | undefined,
    peerName: string,
    peerAvatar: string | null | undefined,
    knownKey: string | null | undefined,
  ) => {
    let chatId = existingChatId;
    let peerKey = knownKey ?? '';
    if (!chatId) {
      const res = await openChat(peerId);
      chatId = res.chatId;
      if (!peerKey) peerKey = res.peerPublicKey ?? '';
    }
    router.push({
      pathname: '/chat/[id]',
      params: { id: chatId, peerId, peerName, peerAvatar: peerAvatar ?? '', peerKey },
    });
  }, [openChat]);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: th.bg }]}>
      <View style={[{ flex: 1, width: '100%' }, isTablet && { maxWidth: 720, alignSelf: 'center' }]}>

      {/* ── Header ── */}
      <View style={[s.header, { borderBottomColor: th.divider }]}>
        <Text style={[s.heading, { color: th.textDark }]}>Add Friends</Text>
      </View>

      {/* ── Search bar ── */}
      <View style={[s.searchWrap, { backgroundColor: th.bg }]}>
        <View style={[s.searchBar, { backgroundColor: th.inputBg }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={th.textSoft} />
          <TextInput
            style={[s.searchInput, { color: th.textDark }]}
            placeholder="Search by username…"
            placeholderTextColor={th.textSoft}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} hitSlop={8}>
              <MaterialCommunityIcons name="close-circle" size={18} color={th.textSoft} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Results ── */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={s.emptyState}>
            <ActivityIndicator color={th.accent} />
          </View>
        )}
        {!loading && searched && results.length === 0 && (
          <View style={s.emptyState}>
            <MaterialCommunityIcons name="account-search-outline" size={48} color={th.textSoft} />
            <Text style={[s.emptyTitle, { color: th.textDark }]}>No results</Text>
            <Text style={[s.emptyText,  { color: th.textSoft }]}>Try a different username</Text>
          </View>
        )}
        {!loading && !searched && (
          <View style={s.emptyState}>
            <MaterialCommunityIcons name="account-group-outline" size={48} color={th.textSoft} />
            <Text style={[s.emptyTitle, { color: th.textDark }]}>Find your people</Text>
            <Text style={[s.emptyText,  { color: th.textSoft }]}>Type at least 2 characters to search</Text>
          </View>
        )}
        {results.map(u => <UserCard key={u.id} user={u} onAdd={sendFriendRequest} onMessage={handleMessage} onRemove={handleRemove} th={th} />)}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 8 : 4,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },

  searchWrap:  { paddingHorizontal: 16, paddingVertical: 12 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },

  list:        { flex: 1 },
  listContent: { paddingBottom: 40 },

  card:      { marginHorizontal: 16, marginBottom: 2 },
  cardInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 12, gap: 14 },
  avatar:    { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  cardInfo:     { flex: 1 },
  cardUsername: { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.1 },
  cardMeta:     { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  btn: { flexDirection: 'row', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, minWidth: 88, alignItems: 'center', justifyContent: 'center' },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  emptyText:  { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
});
