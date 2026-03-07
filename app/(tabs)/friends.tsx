import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
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

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG        = '#F4F6F8';
const CARD_BG   = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_MED  = '#5A7182';
const TEXT_SOFT = '#8FA3B1';
const ACCENT    = '#4CAF82';

// ─── Avatar colours (deterministic from first char) ──────────────────────────
const AVATAR_COLORS = ['#4CAF82','#5C9BD6','#F4A261','#E76F51','#8B5CF6','#EC4899','#14B8A6'];
function avatarColor(username: string) {
  const i = username.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[i];
}
function joinYear(created_at: string) {
  return new Date(created_at).getFullYear();
}

// ─── Result card ──────────────────────────────────────────────────────────────
function UserCard({ user }: { user: UserInfo }) {
  const scale = useRef(new Animated.Value(1)).current;
  const bg    = avatarColor(user.username);

  const onIn  = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30, bounciness: 12 }).start();
  const onPress = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
      <Pressable style={styles.cardInner} onPressIn={onIn} onPressOut={onOut} onPress={onPress}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: bg }]}>
          <Text style={styles.avatarLetter}>{user.username[0].toUpperCase()}</Text>
        </View>
        {/* Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.cardUsername}>@{user.username}</Text>
          <Text style={styles.cardMeta}>Privy since {joinYear(user.created_at)}</Text>
        </View>
        {/* Add friend placeholder */}
        <View style={styles.addBtn}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function FriendsScreen() {
  const { findUser, user: currentUser } = useAuth();
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await findUser(trimmed);
        setResults(res);
        setSearched(true);
      } catch { setResults([]); }
      finally  { setLoading(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [query, findUser]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setSearched(false);
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.blobTopRight} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.heading}>Find People</Text>
        <Text style={styles.subheading}>Search by username</Text>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="username…"
            placeholderTextColor={TEXT_SOFT}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Results ── */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={styles.emptyState}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.emptyText}>Searching…</Text>
          </View>
        )}

        {!loading && searched && results.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🕵️</Text>
            <Text style={styles.emptyTitle}>No one found</Text>
            <Text style={styles.emptyText}>Try a different username</Text>
          </View>
        )}

        {!loading && !searched && query.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyTitle}>Find your friends</Text>
            <Text style={styles.emptyText}>
              Everyone on Privy has a unique username.{'\n'}Type at least 2 characters to search.
            </Text>
          </View>
        )}

        {results.map(u => <UserCard key={u.id} user={u} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  blobTopRight: {
    position: 'absolute', top: -60, right: -60, width: 200, height: 200,
    borderRadius: 100, backgroundColor: 'rgba(76,175,130,0.06)', pointerEvents: 'none',
  },

  // ── Header ───────────────────────────────────────────────────────
  header:     { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 16 : 8, paddingBottom: 8 },
  heading:    { fontSize: 28, fontWeight: '800', color: TEXT_DARK, letterSpacing: 0.3 },
  subheading: { fontSize: 14, color: TEXT_SOFT, marginTop: 2 },

  // ── Search ───────────────────────────────────────────────────────
  searchRow: { paddingHorizontal: 20, marginBottom: 16 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD_BG, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
    ...Platform.select({
      web:     { boxShadow: '0px 4px 12px rgba(123,158,192,0.14)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12, elevation: 4 },
    }),
  },
  searchIcon:  { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 15, color: TEXT_DARK, fontWeight: '500' },
  clearBtn:    { paddingHorizontal: 4 },
  clearBtnText:{ fontSize: 14, color: TEXT_SOFT, fontWeight: '600' },

  // ── Results list ─────────────────────────────────────────────────
  list:        { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },

  // ── User card ────────────────────────────────────────────────────
  card: {
    backgroundColor: CARD_BG, borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)',
    ...Platform.select({
      web:     { boxShadow: '0px 6px 18px rgba(123,158,192,0.14)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 18, elevation: 6 },
    }),
  },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  avatar:    { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  cardInfo:  { flex: 1 },
  cardUsername: { fontSize: 16, fontWeight: '700', color: TEXT_DARK },
  cardMeta:     { fontSize: 13, color: TEXT_SOFT,  marginTop: 2 },
  addBtn: {
    backgroundColor: 'rgba(76,175,130,0.1)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(76,175,130,0.3)',
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: ACCENT },

  // ── Empty / loading states ───────────────────────────────────────
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 48, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_DARK },
  emptyText:  { fontSize: 14, color: TEXT_SOFT, textAlign: 'center', lineHeight: 21 },
});
