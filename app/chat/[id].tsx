/**
 * app/chat/[id].tsx – Full E2EE 1-on-1 chat screen
 *
 * Route params (passed via router.push):
 *   id         – chat_id (UUID)
 *   peerId     – peer's user id
 *   peerName   – peer's username
 *   peerAvatar – peer's avatar_url (may be empty)
 *   peerKey    – peer's ECDH public key (base64), may be empty if not yet known
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, type Message } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { decryptMessage, encryptMessage, getSharedKey } from '@/lib/e2ee';
import { showMessageNotification } from '@/lib/notifications';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// ─── Image Viewer Modal ──────────────────────────────────────────────────────
interface ImageViewerProps {
  visible: boolean;
  b64: string;
  onClose: () => void;
  onForward: () => void;
}
function ImageViewerModal({ visible, b64, onClose, onForward }: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to save images.');
        return;
      }
      // Write base64 to a temp file then save to camera roll
      const tmpPath = FileSystem.cacheDirectory + `img_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: 'base64' as any });
      await MediaLibrary.saveToLibraryAsync(tmpPath);
      Alert.alert('Saved', 'Image saved to your photo library.');
    } catch (e: any) {
      Alert.alert('Error', 'Could not save image.');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    try {
      const tmpPath = FileSystem.cacheDirectory + `img_share_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: 'base64' as any });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(tmpPath, { mimeType: 'image/jpeg' });
    } catch { Alert.alert('Error', 'Could not share image.'); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={iv.backdrop}>
        {/* Toolbar */}
        <View style={[iv.toolbar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} style={iv.toolBtn} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={24} color="#fff" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={handleShare} style={iv.toolBtn} hitSlop={12}>
              <MaterialCommunityIcons name="share-variant-outline" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={onForward} style={iv.toolBtn} hitSlop={12}>
              <MaterialCommunityIcons name="share" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={handleSave} style={iv.toolBtn} hitSlop={12} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialCommunityIcons name="download" size={22} color="#fff" />}
            </Pressable>
          </View>
        </View>
        {/* Zoomable image */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          bouncesZoom
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
        >
          <Image
            source={{ uri: `data:image/jpeg;base64,${b64}` }}
            style={{ width: SCREEN_W, height: SCREEN_H * 0.78 }}
            resizeMode="contain"
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
const iv = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  toolbar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  toolBtn:  { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
});

// ─── Message action menu ─────────────────────────────────────────────────────
interface MsgMenuProps {
  visible: boolean;
  isMe: boolean;
  msg: DecryptedMessage | null;
  accent: string;
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForAll: () => void;
  onForward: () => void;
}
function MessageMenu({ visible, isMe, msg, accent, onClose, onDeleteForMe, onDeleteForAll, onForward }: MsgMenuProps) {
  const insets = useSafeAreaInsets();
  if (!msg) return null;
  const items: { label: string; icon: string; color?: string; onPress: () => void }[] = [
    { label: 'Forward', icon: 'share', onPress: onForward },
    { label: 'Delete for me', icon: 'trash-can-outline', color: '#EF4444', onPress: onDeleteForMe },
    ...(isMe && !msg.pending ? [{ label: 'Delete for everyone', icon: 'trash-can', color: '#EF4444', onPress: onDeleteForAll }] : []),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={mm.backdrop} onPress={onClose}>
        <View style={[mm.sheet, { paddingBottom: insets.bottom + 8 }]}>
          {items.map((it, i) => (
            <Pressable
              key={it.label}
              style={({ pressed }) => [mm.item, i > 0 && mm.divider, pressed && { opacity: 0.6 }]}
              onPress={() => { onClose(); setTimeout(it.onPress, 120); }}
            >
              <MaterialCommunityIcons name={it.icon as any} size={22} color={it.color ?? '#fff'} />
              <Text style={[mm.itemText, it.color ? { color: it.color } : {}]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
const mm = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: '#1F2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingHorizontal: 16 },
  item:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15 },
  divider:   { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  itemText:  { fontSize: 15, color: '#fff', fontFamily: 'Inter_400Regular' },
});

// ─── Forward picker modal ────────────────────────────────────────────────────
interface ForwardPickerProps {
  visible: boolean;
  chats: { chat_id: string; name: string; peerPublicKey: string | null; peerId: string }[];
  accent: string;
  textDark: string;
  cardBg: string;
  onClose: () => void;
  onPick: (chatId: string, peerPublicKey: string, peerId: string) => void;
}
function ForwardPicker({ visible, chats, accent, textDark, cardBg, onClose, onPick }: ForwardPickerProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={mm.backdrop} onPress={onClose}>
        <Pressable style={[mm.sheet, { backgroundColor: cardBg, paddingBottom: insets.bottom + 8, maxHeight: '60%' }]}>
          <Text style={[{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: textDark, marginBottom: 12 }]}>Forward to…</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {chats.map(c => (
              <Pressable
                key={c.chat_id}
                style={({ pressed }) => [mm.item, pressed && { opacity: 0.6 }]}
                onPress={() => c.peerPublicKey && onPick(c.chat_id, c.peerPublicKey, c.peerId)}
              >
                <MaterialCommunityIcons name="account-circle-outline" size={28} color={accent} />
                <Text style={[mm.itemText, { color: textDark }]}>{c.name}</Text>
                {!c.peerPublicKey && <Text style={{ color: '#9CA3AF', fontSize: 12 }}>No key</Text>}
              </Pressable>
            ))}
            {chats.length === 0 && (
              <Text style={[mm.itemText, { color: '#9CA3AF', textAlign: 'center', paddingVertical: 24 }]}>No other chats</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecryptedMessage extends Message {
  decryptedText?: string;
  decryptedImageB64?: string;
  decryptedFileData?: { b64: string; name: string; size: number; mimeType: string };
  pending?: boolean;   // optimistic: not yet confirmed by server
  failed?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_KEY_POLLS = 5; // give up after ~15 s of auto-polling

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateSep(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('word') || mime.includes('document')) return 'Word';
  if (mime.includes('sheet') || mime.includes('excel')) return 'Excel';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PPT';
  if (mime === 'text/plain') return 'TXT';
  if (mime === 'text/csv') return 'CSV';
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.includes('zip') || mime.includes('rar')) return 'Archive';
  const ext = mime.split('/').pop() ?? '';
  return ext.toUpperCase();
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'file-image-outline';
  if (mime === 'application/pdf') return 'file-pdf-box';
  if (mime.includes('word') || mime.includes('document')) return 'file-word-outline';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return 'file-excel-outline';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('rar')) return 'folder-zip-outline';
  if (mime.startsWith('video/')) return 'file-video-outline';
  if (mime.startsWith('audio/')) return 'file-music-outline';
  return 'file-outline';
}

async function decryptOne(
  msg: Message,
  sharedKey: Uint8Array,
): Promise<DecryptedMessage> {
  try {
    const raw = await decryptMessage(sharedKey, msg.encrypted_body);
    if (msg.msg_type === 'image') {
      const parsed = JSON.parse(raw) as { b64: string };
      return { ...msg, decryptedImageB64: parsed.b64 };
    }
    if (msg.msg_type === 'file') {
      const parsed = JSON.parse(raw) as { b64: string; name: string; size: number; mimeType: string };
      return { ...msg, decryptedFileData: parsed };
    }
    return { ...msg, decryptedText: raw };
  } catch {
    return { ...msg, decryptedText: '🔒 Unable to decrypt' };
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusTick({ status, accent }: { status: string; accent: string }) {
  if (status === 'sent')
    return <MaterialCommunityIcons name="check" size={13} color="#9CA3AF" />;
  if (status === 'delivered')
    return <MaterialCommunityIcons name="check-all" size={13} color="#9CA3AF" />;
  if (status === 'read')
    return <MaterialCommunityIcons name="check-all" size={13} color={accent} />;
  return null;
}

function TypingDots({ color }: { color: string }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -4, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue:  0, duration: 280, useNativeDriver: true }),
          Animated.delay(600),
        ]),
      ).start();
    anim(dot1, 0); anim(dot2, 160); anim(dot3, 320);
  }, []);
  const dot = (a: Animated.Value) => (
    <Animated.View style={[styles.typingDot, { backgroundColor: color, transform: [{ translateY: a }] }]} />
  );
  return (
    <View style={styles.typingDotsRow}>{dot(dot1)}{dot(dot2)}{dot(dot3)}</View>
  );
}

interface BubbleProps {
  msg:        DecryptedMessage;
  isMe:       boolean;
  accent:     string;
  bubble:     string;
  bubbleMe:   string;
  textColor:  string;
  textMe:     string;
  timeColor:  string;
  onLongPress: (msg: DecryptedMessage) => void;
  onImagePress: (b64: string) => void;
  onFilePress: (data: { b64: string; name: string; mimeType: string }) => void;
}

function Bubble({ msg, isMe, accent, bubble, bubbleMe, textColor, textMe, timeColor, onLongPress, onImagePress, onFilePress }: BubbleProps) {
  const bg = isMe ? bubbleMe : bubble;
  const tc = isMe ? textMe   : textColor;
  const isDeleted = msg.decryptedText === '\u{1F6AB} This message was deleted';

  // ── File messages: Telegram-style standalone card ───────────────────────────
  if (msg.msg_type === 'file') {
    const mime  = msg.decryptedFileData?.mimeType ?? msg.mime_type ?? '';
    const name  = msg.decryptedFileData?.name ?? msg.file_name ?? 'File';
    const szStr = msg.decryptedFileData
      ? formatFileSize(msg.decryptedFileData.size)
      : msg.file_size ? formatFileSize(msg.file_size) : '—';
    const tpStr = mime ? mimeLabel(mime) : '—';
    const icon  = mime ? fileIcon(mime) : 'file-outline';
    const ready = !msg.pending && !msg.failed && !!msg.decryptedFileData;

    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
        <Pressable
          style={[styles.fileCard, { backgroundColor: bg }]}
          onPress={() => ready && onFilePress(msg.decryptedFileData!)}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }}
          delayLongPress={350}
        >
          {/* Row: icon + info + download */}
          <View style={styles.fileCardRow}>
            {/* Circular icon */}
            <View style={[styles.fileIconCircle, { backgroundColor: isMe ? 'rgba(255,255,255,0.25)' : accent + '22' }]}>
              {msg.pending
                ? <ActivityIndicator size="small" color={isMe ? '#fff' : accent} />
                : <MaterialCommunityIcons name={icon as any} size={26} color={isMe ? '#fff' : accent} />
              }
            </View>

            {/* Info */}
            <View style={styles.fileCardInfo}>
              <Text style={[styles.fileNameTxt, { color: tc }]} numberOfLines={1} ellipsizeMode="middle">
                {name}
              </Text>
              <Text style={[styles.fileMetaTxt, { color: isMe ? 'rgba(255,255,255,0.72)' : '#6B7280' }]}>
                {szStr}{'  ·  '}{tpStr}
              </Text>
              <Text style={[styles.fileStatusTxt, { color: msg.failed ? '#EF4444' : isMe ? 'rgba(255,255,255,0.55)' : '#9CA3AF' }]}>
                {msg.pending ? 'Sending…' : msg.failed ? 'Failed' : ready ? 'Tap to open' : 'Decrypting…'}
              </Text>
            </View>

            {/* Download indicator */}
            {ready && (
              <MaterialCommunityIcons
                name="download-outline" size={22}
                color={isMe ? 'rgba(255,255,255,0.8)' : accent}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>

          {/* Footer: timestamp + status */}
          <View style={[styles.bubbleFooter, { marginTop: 6 }]}>
            <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.7)' : timeColor }]}>
              {formatTime(msg.created_at)}
            </Text>
            {isMe && (
              <View style={{ marginLeft: 3 }}>
                {msg.pending
                  ? <MaterialCommunityIcons name="clock-outline" size={13} color="rgba(255,255,255,0.6)" />
                  : msg.failed
                    ? <MaterialCommunityIcons name="alert-circle-outline" size={13} color="#EF4444" />
                    : <StatusTick status={msg.status} accent="#fff" />}
              </View>
            )}
          </View>
        </Pressable>
      </View>
    );
  }

  // ── Normal bubble (text + image) ────────────────────────────────────────────
  return (
    <View style={[styles.bubbleWrap, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
      <Pressable
        onLongPress={() => { if (!isDeleted) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }}}
        delayLongPress={350}
      >
        <View style={[styles.bubble, { backgroundColor: isDeleted ? 'transparent' : bg, maxWidth: '78%', borderWidth: isDeleted ? StyleSheet.hairlineWidth : 0, borderColor: '#9CA3AF' }]}>
          {msg.msg_type === 'image' && msg.decryptedImageB64 ? (
            <Pressable onPress={() => onImagePress(msg.decryptedImageB64!)} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }} delayLongPress={350}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${msg.decryptedImageB64}` }}
                style={styles.msgImage}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <Text style={[styles.msgText, { color: isDeleted ? '#9CA3AF' : tc, fontStyle: isDeleted ? 'italic' : 'normal' }]}>
              {msg.pending ? (msg.decryptedText ?? '') : (msg.decryptedText ?? '…')}
            </Text>
          )}
          <View style={styles.bubbleFooter}>
            <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.7)' : timeColor }]}>
              {formatTime(msg.created_at)}
            </Text>
            {isMe && !isDeleted && (
              <View style={{ marginLeft: 3 }}>
                {msg.pending
                  ? <MaterialCommunityIcons name="clock-outline" size={13} color="rgba(255,255,255,0.6)" />
                  : msg.failed
                    ? <MaterialCommunityIcons name="alert-circle-outline" size={13} color="#EF4444" />
                    : <StatusTick status={msg.status} accent="#fff" />}
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const params   = useLocalSearchParams<{
    id: string; peerId: string; peerName: string; peerAvatar: string; peerKey: string;
  }>();

  const { user, sessionToken, sendMessage: apiSendMessage, getMessages, markRead, deleteMessage, getChats } = useAuth();

  // Colours
  const th        = useAppTheme();
  const bg        = th.bg;
  const card      = th.cardBg;
  const accent    = th.accent;
  const textColor = th.textDark;
  const subText   = th.textSoft;
  const border    = th.border;
  const bubbleMe  = accent;
  const bubble    = card;
  const textMe    = '#fff';
  const { isTablet } = useLayout();

  const [messages,   setMessages]   = useState<DecryptedMessage[]>([]);
  const [inputText,  setInputText]  = useState('');
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [sharedKey,  setSharedKey]  = useState<Uint8Array | null>(null);
  const [hasMore,    setHasMore]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [keyError,    setKeyError]   = useState(false);
  const [retryCount,  setRetryCount] = useState(0);
  const [keyWaiting,  setKeyWaiting] = useState(false);
  const [keyTimedOut, setKeyTimedOut] = useState(false);
  const [peerTyping,  setPeerTyping] = useState(false);
  const [viewerImg,   setViewerImg]  = useState<string | null>(null);
  const [menuMsg,     setMenuMsg]    = useState<DecryptedMessage | null>(null);
  const [forwardSrc,  setForwardSrc] = useState<{ text?: string; b64?: string } | null>(null);
  const [forwardChats, setForwardChats] = useState<{ chat_id: string; name: string; peerPublicKey: string | null; peerId: string }[]>([]);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [showAttachTray, setShowAttachTray] = useState(false);
  const chatChannelRef  = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);
  const keyPollRef = useRef(0);

  const listRef = useRef<FlatList>(null);
  const pendingIdRef = useRef(0);

  // ── Resolve + derive shared key ──────────────────────────────────────────
  // Fast path: if the home screen already passed peerKey, derive the shared
  // key immediately (pure JS P-256, ~10 ms, zero network). Then silently
  // re-verify from the server in the background in case the key rotated.
  // Only fall back to polling if the peer hasn't published a key yet.
  useEffect(() => {
    if (!params.peerId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    keyPollRef.current = 0;
    setKeyTimedOut(false);
    setKeyError(false);

    const resolveFromKey = async (keyB64: string) => {
      const key = await getSharedKey(params.peerId, keyB64);
      if (!cancelled) {
        setSharedKey(key);
        setKeyWaiting(false);
        setKeyError(false);
        setKeyTimedOut(false);
      }
    };

    const fetchFromServer = async (): Promise<string> => {
      const res = await callAuthFunction({ action: 'get-public-key', sessionToken, userId: params.peerId });
      return res.publicKey ?? '';
    };

    const pollUntilKey = async () => {
      try {
        const keyB64 = await fetchFromServer().catch(() => '');
        if (!keyB64) {
          keyPollRef.current += 1;
          if (keyPollRef.current >= MAX_KEY_POLLS) {
            if (!cancelled) { setKeyWaiting(false); setKeyTimedOut(true); }
            return;
          }
          if (!cancelled) pollTimer = setTimeout(pollUntilKey, 3000);
          return;
        }
        await resolveFromKey(keyB64);
      } catch {
        if (!cancelled) { setKeyError(true); setKeyWaiting(false); }
      }
    };

    if (params.peerKey) {
      // ✅ Instant: key already known — no network needed
      resolveFromKey(params.peerKey).catch(() => {});
      // Background: silently refresh in case key changed
      fetchFromServer()
        .then(serverKey => {
          if (!cancelled && serverKey && serverKey !== params.peerKey)
            resolveFromKey(serverKey).catch(() => {});
        })
        .catch(() => {});
    } else {
      // Peer hasn't published a key yet — poll the server
      setKeyWaiting(true);
      pollUntilKey();
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [params.peerId, params.peerKey, sessionToken, retryCount]);

  // ── Decrypt helper ───────────────────────────────────────────────────────
  const decryptBatch = useCallback(
    async (msgs: Message[]): Promise<DecryptedMessage[]> => {
      if (!sharedKey) return msgs.map(m => ({ ...m, decryptedText: '🔒' }));
      return Promise.all(msgs.map(m => decryptOne(m, sharedKey)));
    },
    [sharedKey],
  );

  // ── Initial fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const raw = await getMessages(params.id);
      if (cancelled) return;
      const dec = await decryptBatch(raw);
      setMessages(dec);
      setHasMore(raw.length === 50);
      setLoading(false);
      // mark all as read
      markRead(params.id).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [sharedKey, params.id]);

  // ── Load older messages ──────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !sharedKey || messages.length === 0) return;
    setLoadingMore(true);
    const oldest = messages[messages.length - 1].created_at;
    const raw = await getMessages(params.id, oldest);
    const dec = await decryptBatch(raw);
    setMessages(prev => [...prev, ...dec]);
    setHasMore(raw.length === 50);
    setLoadingMore(false);
  }, [loadingMore, hasMore, sharedKey, messages, params.id, decryptBatch]);

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedKey) return;
    const sub = supabaseClient
      .channel(`chat-${params.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload: { new: Record<string, unknown> }) => {
          const raw = payload.new as unknown as Message;
          if (raw.chat_id !== params.id) return;
          // Remove matching optimistic message
          setMessages(prev => {
            const idx = prev.findIndex(m => m.pending && m.decryptedText &&
              m.sender_id === raw.sender_id);
            if (idx !== -1) {
              // replace optimistic with real
              const next = [...prev];
              next[idx] = { ...raw, decryptedText: next[idx].decryptedText, decryptedImageB64: next[idx].decryptedImageB64 };
              return next;
            }
            return prev;
          });
          const dec = await decryptOne(raw, sharedKey);
          setMessages(prev => {
            // avoid duplicate
            if (prev.some(m => m.id === raw.id)) return prev;
            return [dec, ...prev];
          });
          if (raw.sender_id !== user?.id) {
            markRead(params.id).catch(() => {});
            // Show local notification so user knows when a message arrives
            const preview = dec.decryptedText ?? (dec.decryptedImageB64 ? '📷 Photo' : '🔒 Message');
            showMessageNotification({
              senderName:  params.peerName,
              preview,
              chatId:      params.id,
              peerId:      params.peerId,
              peerName:    params.peerName,
              peerAvatar:  params.peerAvatar,
              peerKey:     params.peerKey,
            }).catch(() => {});
            // Peer is no longer typing once they've sent
            setPeerTyping(false);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload: { new: Record<string, unknown> }) => {
          const upd = payload.new as unknown as Message;
          if (upd.chat_id !== params.id) return;
          setMessages(prev =>
            prev.map(m => m.id === upd.id ? { ...m, status: upd.status } : m),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload: { old: Record<string, unknown> }) => {
          const deleted = payload.old as { id?: string };
          if (deleted.id) {
            setMessages(prev => prev.filter(m => m.id !== deleted.id));
          }
        },
      )
      .on('broadcast', { event: 'message_deleted' }, (payload: any) => {
        const { messageId } = payload.payload ?? {};
        if (messageId) setMessages(prev => prev.filter(m => m.id !== messageId));
      })
      .subscribe();

    chatChannelRef.current = sub;
    return () => { chatChannelRef.current = null; supabaseClient.removeChannel(sub); };
  }, [sharedKey, params.id, user?.id]);

  // ── Typing indicator channel ──────────────────────────────────────
  useEffect(() => {
    const ch = supabaseClient
      .channel(`typing:${params.id}`)
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        if (payload.payload?.userId === user?.id) return; // ignore own events
        setPeerTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setPeerTyping(false), 3000);
      })
      .subscribe();
    typingChannelRef.current = ch;
    return () => {
      supabaseClient.removeChannel(ch);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [params.id, user?.id]);

  const broadcastTyping = useCallback(() => {
    typingChannelRef.current?.send({
      type: 'broadcast', event: 'typing',
      payload: { userId: user?.id },
    });
  }, [user?.id]);

  // ── Send text ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sharedKey || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText('');
    setSending(true);

    const tempId = `pending-${pendingIdRef.current++}`;
    const optimistic: DecryptedMessage = {
      id: tempId, chat_id: params.id, sender_id: user!.id,
      encrypted_body: '', msg_type: 'text', status: 'sent',
      created_at: new Date().toISOString(),
      decryptedText: text, pending: true,
    };
    setMessages(prev => [optimistic, ...prev]);

    try {
      const enc = await encryptMessage(sharedKey, text);
      await apiSendMessage(params.id, enc, 'text');
    } catch {
      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m),
      );
    } finally {
      setSending(false);
    }
  }, [inputText, sharedKey, sending, params.id, user, apiSendMessage]);

  // ── Take photo from camera (E2EE) ─────────────────────────────────────
  const handleTakePhoto = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) { Alert.alert('Error', 'Could not read photo data.'); return; }
    setSending(true);
    try {
      const enc = await encryptMessage(sharedKey, JSON.stringify({ b64 }));
      const tempId = `pending-img-${pendingIdRef.current++}`;
      const optimistic: DecryptedMessage = {
        id: tempId, chat_id: params.id, sender_id: user!.id,
        encrypted_body: '', msg_type: 'image', status: 'sent',
        created_at: new Date().toISOString(),
        decryptedImageB64: b64, pending: true,
      };
      setMessages(prev => [optimistic, ...prev]);
      await apiSendMessage(params.id, enc, 'image', { mimeType: 'image/jpeg' });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not send photo');
    } finally {
      setSending(false);
    }
  }, [sharedKey, params.id, user, apiSendMessage]);

  // ── Pick document / file (E2EE) ──────────────────────────────────────────
  const handlePickDocument = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64 as any,
      });
      const payload = {
        b64,
        name: asset.name,
        size: asset.size ?? 0,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      };
      setSending(true);
      try {
        const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
        const tempId = `pending-file-${pendingIdRef.current++}`;
        const optimistic: DecryptedMessage = {
          id: tempId, chat_id: params.id, sender_id: user!.id,
          encrypted_body: '', msg_type: 'file', status: 'sent',
          created_at: new Date().toISOString(),
          decryptedFileData: payload, pending: true,
        };
        setMessages(prev => [optimistic, ...prev]);
        await apiSendMessage(params.id, enc, 'file', {
          fileName: asset.name,
          fileSize: asset.size ?? 0,
          mimeType: asset.mimeType ?? 'application/octet-stream',
        });
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not send file');
      } finally {
        setSending(false);
      }
    } catch {
      // user cancelled — no-op
    }
  }, [sharedKey, params.id, user, apiSendMessage]);

  // ── Send image (original quality, E2EE) ─────────────────────────────────
  const handlePickImage = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,    // original quality
      base64: true,  // get base64 directly — no FileSystem round-trip
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) { Alert.alert('Error', 'Could not read image data.'); return; }

    setSending(true);
    try {
      const enc = await encryptMessage(sharedKey, JSON.stringify({ b64 }));
      const tempId = `pending-img-${pendingIdRef.current++}`;
      const optimistic: DecryptedMessage = {
        id: tempId, chat_id: params.id, sender_id: user!.id,
        encrypted_body: '', msg_type: 'image', status: 'sent',
        created_at: new Date().toISOString(),
        decryptedImageB64: b64, pending: true,
      };
      setMessages(prev => [optimistic, ...prev]);
      await apiSendMessage(params.id, enc, 'image', { mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not send image');
    } finally {
      setSending(false);
    }
  }, [sharedKey, params.id, user, apiSendMessage]);

  // ── Open / save received file ─────────────────────────────────────────────
  // Both platforms: write to cache then open share sheet.
  // Android share sheet has "Save to Downloads" built-in.
  // iOS share sheet has "Save to Files" built-in.
  // No SAF createFileAsync = no writability errors.
  const handleFileOpen = useCallback(async (data: { b64: string; name: string; mimeType: string }) => {
    const writeAndShare = async (dialogTitle: string) => {
      const tmpPath = (FileSystem.cacheDirectory ?? '') + data.name;
      await FileSystem.writeAsStringAsync(tmpPath, data.b64, { encoding: 'base64' as any });
      await Sharing.shareAsync(tmpPath, { mimeType: data.mimeType, dialogTitle });
    };
    Alert.alert(
      data.name,
      data.mimeType,
      [
        { text: 'Open / Share', onPress: () => writeAndShare(data.name).catch(e => Alert.alert('Error', e.message)) },
        { text: 'Save to Downloads / Files', onPress: () => writeAndShare('Save ' + data.name).catch(e => Alert.alert('Error', e.message)) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, []);

  // ── Delete message ───────────────────────────────────────────────────────
  const handleDeleteForMe = useCallback((msg: DecryptedMessage) => {
    setMessages(prev => prev.filter(m => m.id !== msg.id));
  }, []);

  const handleDeleteForAll = useCallback(async (msg: DecryptedMessage) => {
    // Remove from sender's screen immediately
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    try {
      await deleteMessage(msg.id, true);
      // Broadcast to peer so their screen removes it instantly
      // (acts as a reliable fallback alongside the Realtime DELETE event)
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'message_deleted',
        payload: { messageId: msg.id },
      });
    } catch (e: any) {
      // Restore message on failure
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      });
      Alert.alert('Error', e?.message ?? 'Could not delete message. Please try again.');
    }
  }, [deleteMessage]);

  // ── Forward message ──────────────────────────────────────────────────────
  const openForward = useCallback(async (src: { text?: string; b64?: string }) => {
    setForwardSrc(src);
    const all = await getChats().catch(() => []);
    setForwardChats(
      all
        .filter(c => c.chat_id !== params.id)
        .map(c => ({ chat_id: c.chat_id, name: c.user.username, peerPublicKey: c.peer_public_key, peerId: c.user.id })),
    );
    setShowForwardPicker(true);
  }, [getChats, params.id]);

  const handleForward = useCallback(async (toChatId: string, toPeerPublicKey: string, toPeerId: string) => {
    if (!forwardSrc) return;
    setForwarding(true);
    setShowForwardPicker(false);
    try {
      const toKey = await getSharedKey(toPeerId, toPeerPublicKey);
      if (forwardSrc.b64) {
        const enc = await encryptMessage(toKey, JSON.stringify({ b64: forwardSrc.b64 }));
        await apiSendMessage(toChatId, enc, 'image', { mimeType: 'image/jpeg' });
      } else if (forwardSrc.text) {
        const enc = await encryptMessage(toKey, forwardSrc.text);
        await apiSendMessage(toChatId, enc, 'text');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not forward message.');
    } finally {
      setForwarding(false);
      setForwardSrc(null);
    }
  }, [forwardSrc, apiSendMessage]);

  // ── Render ───────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: DecryptedMessage; index: number }) => {
      const isMe   = item.sender_id === user?.id;
      const newer  = messages[index - 1];
      const showSep = !newer || !sameDay(item.created_at, newer.created_at);
      return (
        <>
          {showSep && (
            <View style={styles.dateSepWrap}>
              <Text style={[styles.dateSepText, { color: subText, backgroundColor: bg }]}>
                {formatDateSep(item.created_at)}
              </Text>
            </View>
          )}
          <Bubble
            msg={item} isMe={isMe}
            accent={accent} bubble={bubble} bubbleMe={bubbleMe}
            textColor={textColor} textMe={textMe} timeColor={subText}
            onLongPress={(m) => setMenuMsg(m)}
            onImagePress={(b64) => setViewerImg(b64)}
            onFilePress={handleFileOpen}
          />
        </>
      );
    },
    [messages, user?.id, accent, bubble, bubbleMe, textColor, subText, bg, handleFileOpen],
  );

  const keyExtractor = (item: DecryptedMessage) => item.id;

  // ── Peer key timed out ────────────────────────────────────────────────
  if (keyTimedOut) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{params.peerName}</Text>
        </View>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="key-alert-outline" size={48} color={subText} />
          <Text style={[styles.noKeyText, { color: subText, textAlign: 'center' }]}>
            {`${params.peerName} needs to open
the app to enable encryption.`}
          </Text>
          <Text style={[{ color: subText, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6, textAlign: 'center' }]}>
            Ask them to open Privy, then tap Retry.
          </Text>
          <Pressable
            onPress={() => { setKeyTimedOut(false); setKeyWaiting(false); setRetryCount(c => c + 1); }}
            style={[styles.retryBtn, { backgroundColor: accent, marginTop: 20 }]}
          >
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Waiting for peer's key (auto-polling) ─────────────────────────────
  // Only shown when peer has never published a key (very rare).
  if (keyWaiting) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{params.peerName}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={accent} size="large" />
          <Text style={[styles.noKeyText, { color: subText, marginTop: 16 }]}>
            {`Setting up secure channel\nwith ${params.peerName}…`}
          </Text>
          <Text style={[{ color: subText, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6 }]}>
            Waiting for encryption key…
          </Text>
        </View>
      </View>
    );
  }

  // ── Key error (network / crypto failure) ───────────────────────────
  if (keyError) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{params.peerName}</Text>
        </View>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="key-alert-outline" size={48} color={subText} />
          <Text style={[styles.noKeyText, { color: subText }]}>
            {"Could not establish\na secure connection."}
          </Text>
          <Pressable
            onPress={() => { setKeyError(false); setRetryCount(c => c + 1); }}
            style={[styles.retryBtn, { backgroundColor: accent }]}
          >
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}
      behavior="padding"
      keyboardVerticalOffset={insets.top}
    >
      <View style={[{ flex: 1, width: '100%' }, isTablet && { maxWidth: 720, alignSelf: 'center' as const }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
        </Pressable>
        {params.peerAvatar ? (
          <Image source={{ uri: params.peerAvatar }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatarFallback, { backgroundColor: accent + '33' }]}>
            <Text style={[styles.avatarInitial, { color: accent }]}>
              {(params.peerName ?? '?')[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.headerName, { color: textColor }]} numberOfLines={1}>
            {params.peerName}
          </Text>
          {peerTyping ? (
            <View style={styles.typingRow}>
              <TypingDots color={accent} />
              <Text style={[styles.typingLabel, { color: accent }]}>typing…</Text>
            </View>
          ) : (
            <Text style={[styles.headerSub, { color: subText }]}>End-to-end encrypted</Text>
          )}
        </View>
        <MaterialCommunityIcons name="lock-outline" size={16} color={subText} style={{ marginRight: 4 }} />
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={accent} size="large" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          inverted
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator color={accent} style={{ margin: 16 }} />
              : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialCommunityIcons name="chat-outline" size={48} color={subText} />
              <Text style={[styles.emptyText, { color: subText }]}>
                No messages yet.{'\n'}Say hello! 👋
              </Text>
            </View>
          }
        />
      )}

      {/* Attach tray */}
        {showAttachTray && (
          <View style={[styles.attachTray, { backgroundColor: bg, borderTopColor: border }]}>
            <Pressable style={[styles.trayBtn, { backgroundColor: card }]} onPress={handleTakePhoto} disabled={sending || !sharedKey}>
              <MaterialCommunityIcons name="camera-outline" size={26} color={accent} />
              <Text style={[styles.trayLabel, { color: subText }]}>Camera</Text>
            </Pressable>
            <Pressable style={[styles.trayBtn, { backgroundColor: card }]} onPress={handlePickImage} disabled={sending || !sharedKey}>
              <MaterialCommunityIcons name="image-multiple-outline" size={26} color={accent} />
              <Text style={[styles.trayLabel, { color: subText }]}>Gallery</Text>
            </Pressable>
            <Pressable style={[styles.trayBtn, { backgroundColor: card }]} onPress={handlePickDocument} disabled={sending || !sharedKey}>
              <MaterialCommunityIcons name="file-document-outline" size={26} color={accent} />
              <Text style={[styles.trayLabel, { color: subText }]}>Document</Text>
            </Pressable>
          </View>
        )}

      {/* Input bar */}
        <View style={[
          styles.inputBar,
          { borderTopColor: border, backgroundColor: bg, paddingBottom: insets.bottom + 8 },
        ]}>
          <Pressable
            onPress={() => setShowAttachTray(v => !v)}
            style={[styles.attachBtn, { backgroundColor: card }]}
            hitSlop={8}
            disabled={sending || !sharedKey}
          >
            <MaterialCommunityIcons
              name={showAttachTray ? 'close' : 'plus'}
              size={22}
              color={showAttachTray ? accent : subText}
            />
          </Pressable>

          <TextInput
            style={[styles.input, { backgroundColor: card, color: textColor }]}
            placeholder="Message…"
            placeholderTextColor={subText}
            value={inputText}
            onChangeText={t => { setInputText(t); broadcastTyping(); }}
            multiline
            maxLength={2000}
            editable={!!sharedKey}
            returnKeyType="default"
          />

          <Pressable
            onPress={handleSend}
            disabled={!inputText.trim() || sending || !sharedKey}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  !inputText.trim() || !sharedKey ? (card) : accent,
              },
            ]}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <MaterialCommunityIcons
                  name="send"
                  size={20}
                  color={!inputText.trim() || !sharedKey ? subText : '#fff'}
                />}
          </Pressable>
        </View>
      </View>

      {/* ── Image viewer modal ── */}
      <ImageViewerModal
        visible={!!viewerImg}
        b64={viewerImg ?? ''}
        onClose={() => setViewerImg(null)}
        onForward={() => {
          const b64 = viewerImg;
          setViewerImg(null);
          if (b64) setTimeout(() => openForward({ b64 }), 200);
        }}
      />

      {/* ── Message action menu ── */}
      <MessageMenu
        visible={!!menuMsg}
        isMe={menuMsg?.sender_id === user?.id}
        msg={menuMsg}
        accent={accent}
        onClose={() => setMenuMsg(null)}
        onDeleteForMe={() => { if (menuMsg) handleDeleteForMe(menuMsg); setMenuMsg(null); }}
        onDeleteForAll={() => { if (menuMsg) handleDeleteForAll(menuMsg); setMenuMsg(null); }}
        onForward={() => {
          const m = menuMsg;
          setMenuMsg(null);
          if (m) {
            setTimeout(() => {
              if (m.decryptedImageB64) openForward({ b64: m.decryptedImageB64 });
              else if (m.decryptedText) openForward({ text: m.decryptedText });
            }, 200);
          }
        }}
      />

      {/* ── Forward picker ── */}
      <ForwardPicker
        visible={showForwardPicker}
        chats={forwardChats}
        accent={accent}
        textDark={textColor}
        cardBg={card}
        onClose={() => { setShowForwardPicker(false); setForwardSrc(null); }}
        onPick={handleForward}
      />

      {/* ── Forwarding spinner overlay ── */}
      {forwarding && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1 },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },

  // Header
  header:        { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn:       { marginRight: 4 },
  headerAvatar:  { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: 16, fontWeight: '700' },
  headerName:    { fontSize: 16, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  headerSub:     { fontSize: 11, marginTop: 1, fontFamily: 'Inter_400Regular' },

  // Messages
  bubbleWrap:    { marginVertical: 2 },
  bubbleLeft:    { alignItems: 'flex-start' },
  bubbleRight:   { alignItems: 'flex-end' },
  bubble:        { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 6 },
  msgText:       { fontSize: 15, lineHeight: 21, fontFamily: 'Inter_400Regular' },
  msgImage:      { width: 220, height: 180, borderRadius: 12 },
  bubbleFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  timeText:      { fontSize: 11, fontFamily: 'Inter_400Regular' },

  // Date separator
  dateSepWrap:   { alignItems: 'center', marginVertical: 10 },
  dateSepText:   { fontSize: 12, fontFamily: 'Inter_400Regular', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },

  // Empty state
  emptyWrap:     { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyText:     { textAlign: 'center', fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },

  // Input
  inputBar:      { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  attachBtn:     { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  attachTray:    { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  trayBtn:       { alignItems: 'center', gap: 6, width: 80, paddingVertical: 12, borderRadius: 14 },
  trayLabel:     { fontSize: 12, fontFamily: 'Inter_400Regular' },
  fileCard:      { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 280, minWidth: 210 },
  fileCardRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileIconCircle:{ width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  fileCardInfo:  { flex: 1, gap: 2 },
  fileNameTxt:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 17 },
  fileMetaTxt:   { fontSize: 11, fontFamily: 'Inter_400Regular' },
  fileStatusTxt: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  input:         { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120, fontFamily: 'Inter_400Regular' },
  sendBtn:       { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },

  // No-key state
  noKeyText:     { textAlign: 'center', fontSize: 14, lineHeight: 22, marginHorizontal: 32, fontFamily: 'Inter_400Regular' },
  retryBtn:      { marginTop: 16, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },

  // Typing indicator
  typingRow:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  typingLabel:   { fontSize: 12, fontFamily: 'Inter_400Regular' },
  typingDotsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  typingDot:     { width: 5, height: 5, borderRadius: 3 },
});
