/**
 * app/chat/[id].tsx – Full E2EE 1-on-1 chat screen
 * WhatsApp-style responsive UI with proper safe area handling
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useIsFocused } from '@react-navigation/native';
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
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, type CallSignal, type Message } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { decryptMessage, encryptMessage, getSharedKey } from '@/lib/e2ee';
import { showIncomingCallNotification } from '@/lib/notifications';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

const CALL_EVENT_MIME = 'application/x-privy-call-event';

type CallEventStatus = 'completed' | 'missed' | 'declined' | 'busy';

interface CallEventView {
  status: CallEventStatus;
  durationSeconds: number;
}

interface DecryptedMessage extends Message {
  decryptedText?: string;
  decryptedImageB64?: string;
  decryptedFileData?: { b64: string; name: string; size: number; mimeType: string };
  callEvent?: CallEventView;
  pending?: boolean;
  failed?: boolean;
}

const MAX_KEY_POLLS = 5;
const CHAT_MESSAGE_POLL_MS = 1400;
const CALL_SIGNAL_POLL_MS = 550;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatMessageTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} - ${formatTime(iso)}`;
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

function parseCallEvent(raw: string): CallEventView | null {
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      status?: string;
      durationSeconds?: number;
    };
    if (parsed.kind !== 'call_event') return null;
    if (parsed.status !== 'completed' && parsed.status !== 'missed' && parsed.status !== 'declined' && parsed.status !== 'busy') return null;

    const durationSeconds = Number.isFinite(Number(parsed.durationSeconds))
      ? Math.max(0, Math.floor(Number(parsed.durationSeconds)))
      : 0;

    return {
      status: parsed.status,
      durationSeconds,
    };
  } catch {
    return null;
  }
}

function callEventTitle(callEvent: CallEventView): string {
  if (callEvent.status === 'completed') {
    const mins = Math.floor(callEvent.durationSeconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (callEvent.durationSeconds % 60).toString().padStart(2, '0');
    const duration = `${mins}:${secs}`;
    return callEvent.durationSeconds > 0 ? `Voice call · ${duration}` : 'Voice call';
  }
  if (callEvent.status === 'missed') return 'Missed voice call';
  if (callEvent.status === 'declined') return 'Call declined';
  return 'User busy';
}

function callEventIcon(callEvent: CallEventView): string {
  if (callEvent.status === 'completed') return 'phone-check-outline';
  if (callEvent.status === 'missed') return 'phone-missed-outline';
  if (callEvent.status === 'declined') return 'phone-remove-outline';
  return 'phone-cancel-outline';
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

function matchesPendingDirect(pending: DecryptedMessage, incoming: DecryptedMessage): boolean {
  if (!pending.pending || pending.msg_type !== incoming.msg_type) return false;
  if (pending.msg_type === 'text') return (pending.decryptedText ?? '') === (incoming.decryptedText ?? '');
  if (pending.msg_type === 'image') return !!pending.decryptedImageB64 && pending.decryptedImageB64 === incoming.decryptedImageB64;
  if (pending.msg_type === 'file') {
    return !!pending.decryptedFileData && !!incoming.decryptedFileData && pending.decryptedFileData.name === incoming.decryptedFileData.name && pending.decryptedFileData.size === incoming.decryptedFileData.size;
  }
  return false;
}

async function decryptOne(msg: Message, sharedKey: Uint8Array): Promise<DecryptedMessage> {
  try {
    const raw = await decryptMessage(sharedKey, msg.encrypted_body);
    if (msg.msg_type === 'text' && msg.mime_type === CALL_EVENT_MIME) {
      const callEvent = parseCallEvent(raw);
      if (callEvent) {
        return { ...msg, callEvent, decryptedText: '' };
      }
    }
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

function StatusTick({ status, accent, muted }: { status: string; accent: string; muted: string }) {
  if (status === 'sent') return <MaterialCommunityIcons name="check" size={13} color={muted} />;
  if (status === 'delivered') return <MaterialCommunityIcons name="check-all" size={13} color={muted} />;
  if (status === 'read') return <MaterialCommunityIcons name="check-all" size={13} color={accent} />;
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
          Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay(600),
        ]),
      ).start();
    anim(dot1, 0);
    anim(dot2, 160);
    anim(dot3, 320);
  }, [dot1, dot2, dot3]);
  const dot = (a: Animated.Value) => (
    <Animated.View style={[styles.typingDot, { backgroundColor: color, transform: [{ translateY: a }] }]} />
  );
  return <View style={styles.typingDotsRow}>{dot(dot1)}{dot(dot2)}{dot(dot3)}</View>;
}

interface BubbleProps {
  msg: DecryptedMessage;
  isMe: boolean;
  accent: string;
  muted: string;
  bubble: string;
  bubbleMe: string;
  textColor: string;
  textMe: string;
  timeColor: string;
  onLongPress: (msg: DecryptedMessage) => void;
  onImagePress: (b64: string) => void;
  onFilePress: (data: { b64: string; name: string; mimeType: string }) => void;
}

function Bubble({ msg, isMe, accent, muted, bubble, bubbleMe, textColor, textMe, timeColor, onLongPress, onImagePress, onFilePress }: BubbleProps) {
  const bg = isMe ? bubbleMe : bubble;
  const tc = isMe ? textMe : textColor;
  const isDeleted = msg.decryptedText === '\u{1F6AB} This message was deleted';

  if (msg.callEvent) {
    const cardBg = isMe ? bubbleMe : '#ECFEF3';
    const iconColor = isMe ? '#FFFFFF' : '#047857';
    const subtitleColor = isMe ? 'rgba(255,255,255,0.78)' : '#065F46';

    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
        <View style={[styles.callEventCard, { backgroundColor: cardBg }]}> 
          <View style={styles.callEventHeadRow}>
            <MaterialCommunityIcons name={callEventIcon(msg.callEvent) as any} size={18} color={iconColor} />
            <Text style={[styles.callEventTitle, { color: isMe ? '#FFFFFF' : '#064E3B' }]}>{callEventTitle(msg.callEvent)}</Text>
          </View>
          <Text style={[styles.callEventSub, { color: subtitleColor }]}>Verified call event</Text>
          <View style={styles.bubbleFooter}>
            <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.72)' : '#065F46' }]}>{formatMessageTimestamp(msg.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (msg.msg_type === 'file') {
    const mime = msg.decryptedFileData?.mimeType ?? msg.mime_type ?? '';
    const name = msg.decryptedFileData?.name ?? msg.file_name ?? 'File';
    const szStr = msg.decryptedFileData ? formatFileSize(msg.decryptedFileData.size) : msg.file_size ? formatFileSize(msg.file_size) : '—';
    const tpStr = mime ? mimeLabel(mime) : '—';
    const icon = mime ? fileIcon(mime) : 'file-outline';
    const ready = !msg.pending && !msg.failed && !!msg.decryptedFileData;

    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
        <Pressable
          style={[styles.fileCard, { backgroundColor: bg }]}
          onPress={() => ready && onFilePress(msg.decryptedFileData!)}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }}
          delayLongPress={350}
        >
          <View style={styles.fileCardRow}>
            <View style={[styles.fileIconCircle, { backgroundColor: isMe ? 'rgba(255,255,255,0.25)' : accent + '22' }]}>
              {msg.pending ? <ActivityIndicator size="small" color={isMe ? '#fff' : accent} /> : <MaterialCommunityIcons name={icon as any} size={26} color={isMe ? '#fff' : accent} />}
            </View>
            <View style={styles.fileCardInfo}>
              <Text style={[styles.fileNameTxt, { color: tc }]} numberOfLines={1} ellipsizeMode="middle">{name}</Text>
              <Text style={[styles.fileMetaTxt, { color: isMe ? 'rgba(255,255,255,0.72)' : '#6B7280' }]}>{szStr}{'  ·  '}{tpStr}</Text>
              <Text style={[styles.fileStatusTxt, { color: msg.failed ? '#EF4444' : isMe ? 'rgba(255,255,255,0.55)' : '#9CA3AF' }]}>
                {msg.pending ? 'Sending…' : msg.failed ? 'Failed' : ready ? 'Tap to open' : 'Decrypting…'}
              </Text>
            </View>
            {ready && <MaterialCommunityIcons name="download-outline" size={22} color={isMe ? 'rgba(255,255,255,0.8)' : accent} style={{ marginLeft: 4 }} />}
          </View>
          <View style={[styles.bubbleFooter, { marginTop: 6 }]}>
            <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.7)' : timeColor }]}>{formatMessageTimestamp(msg.created_at)}</Text>
            {isMe && (
              <View style={{ marginLeft: 3 }}>
                {msg.pending ? <MaterialCommunityIcons name="clock-outline" size={13} color="rgba(255,255,255,0.6)" /> : msg.failed ? <MaterialCommunityIcons name="alert-circle-outline" size={13} color="#EF4444" /> : <StatusTick status={msg.status} accent="#fff" muted={muted} />}
              </View>
            )}
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrap, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
      <Pressable
        onLongPress={() => { if (!isDeleted) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }}}
        delayLongPress={350}
      >
        <View style={[styles.bubble, { backgroundColor: isDeleted ? 'transparent' : bg, maxWidth: '78%', borderWidth: isDeleted ? StyleSheet.hairlineWidth : 0, borderColor: '#9CA3AF' }]}>
          {msg.msg_type === 'image' && msg.decryptedImageB64 ? (
            <Pressable onPress={() => onImagePress(msg.decryptedImageB64!)} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); }} delayLongPress={350}>
              <Image source={{ uri: `data:image/jpeg;base64,${msg.decryptedImageB64}` }} style={styles.msgImage} resizeMode="cover" />
            </Pressable>
          ) : (
            <Text style={[styles.msgText, { color: isDeleted ? '#9CA3AF' : tc, fontStyle: isDeleted ? 'italic' : 'normal' }]}>
              {msg.pending ? (msg.decryptedText ?? '') : (msg.decryptedText ?? '…')}
            </Text>
          )}
          <View style={styles.bubbleFooter}>
            <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.7)' : timeColor }]}>{formatMessageTimestamp(msg.created_at)}</Text>
            {isMe && !isDeleted && (
              <View style={{ marginLeft: 3 }}>
                {msg.pending ? <MaterialCommunityIcons name="clock-outline" size={13} color="rgba(255,255,255,0.6)" /> : msg.failed ? <MaterialCommunityIcons name="alert-circle-outline" size={13} color="#EF4444" /> : <StatusTick status={msg.status} accent="#fff" muted={muted} />}
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function ImageViewerModal({ visible, b64, onClose, onForward, insets }: { visible: boolean; b64: string; onClose: () => void; onForward: () => void; insets: { top: number; bottom: number; left: number; right: number } }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access to save images.'); return; }
      const tmpPath = FileSystem.cacheDirectory + `img_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: 'base64' as any });
      await MediaLibrary.saveToLibraryAsync(tmpPath);
      Alert.alert('Saved', 'Image saved to your photo library.');
    } catch { Alert.alert('Error', 'Could not save image.'); }
    finally { setSaving(false); }
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
      <View style={ivStyles.backdrop}>
        <View style={[ivStyles.toolbar, { paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }]}>
          <Pressable onPress={onClose} style={ivStyles.toolBtn} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={24} color="#fff" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={handleShare} style={ivStyles.toolBtn} hitSlop={12}>
              <MaterialCommunityIcons name="share-variant-outline" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={onForward} style={ivStyles.toolBtn} hitSlop={12}>
              <MaterialCommunityIcons name="share" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={handleSave} style={ivStyles.toolBtn} hitSlop={12} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="download" size={22} color="#fff" />}
            </Pressable>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} maximumZoomScale={5} minimumZoomScale={1} bouncesZoom showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} centerContent>
          <Image source={{ uri: `data:image/jpeg;base64,${b64}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </ScrollView>
      </View>
    </Modal>
  );
}

const ivStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
});

interface MessageMenuProps {
  visible: boolean;
  isMe: boolean;
  msg: DecryptedMessage | null;
  accent: string;
  insets: { bottom: number };
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForAll: () => void;
  onForward: () => void;
}

function MessageMenu({ visible, isMe, msg, accent, insets, onClose, onDeleteForMe, onDeleteForAll, onForward }: MessageMenuProps) {
  if (!msg) return null;
  const items: { label: string; icon: string; color?: string; onPress: () => void }[] = [
    { label: 'Forward', icon: 'share', onPress: onForward },
    { label: 'Delete for me', icon: 'trash-can-outline', color: '#EF4444', onPress: onDeleteForMe },
    ...(isMe && !msg.pending ? [{ label: 'Delete for everyone', icon: 'trash-can', color: '#EF4444', onPress: onDeleteForAll }] : []),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={mmStyles.backdrop} onPress={onClose}>
        <View style={[mmStyles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          {items.map((it, i) => (
            <Pressable key={it.label} style={({ pressed }) => [mmStyles.item, i > 0 && mmStyles.divider, pressed && { opacity: 0.6 }]} onPress={() => { onClose(); setTimeout(it.onPress, 120); }}>
              <MaterialCommunityIcons name={it.icon as any} size={22} color={it.color ?? '#fff'} />
              <Text style={[mmStyles.itemText, it.color ? { color: it.color } : {}]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const mmStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1F2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  itemText: { fontSize: 15, color: '#fff' },
});

export default function ChatScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; peerId: string; peerName: string; peerAvatar: string; peerKey: string }>();
  const {
    user,
    sessionToken,
    sendMessage: apiSendMessage,
    getMessages,
    markRead,
    deleteMessage,
    getChats,
    sendCallSignal,
    getCallSignals,
    ackCallSignals,
  } = useAuth();
  const { settings } = useSettings();
  const th = useAppTheme();
  const bg = th.bg;
  const card = th.cardBg;
  const accent = th.accent;
  const textColor = th.textDark;
  const subText = th.textSoft;
  const border = th.border;
  const muted = th.textSoft;
  const bubbleMe = accent;
  const bubble = card;
  const textMe = '#fff';

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sharedKey, setSharedKey] = useState<Uint8Array | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [keyWaiting, setKeyWaiting] = useState(false);
  const [keyTimedOut, setKeyTimedOut] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerHistory, setPeerHistory] = useState<string[]>([]);
  const [viewerImg, setViewerImg] = useState<string | null>(null);
  const [menuMsg, setMenuMsg] = useState<DecryptedMessage | null>(null);
  const [forwardSrc, setForwardSrc] = useState<{ text?: string; b64?: string } | null>(null);
  const [forwardChats, setForwardChats] = useState<{ chat_id: string; name: string; peerPublicKey: string | null; peerId: string }[]>([]);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [showAttachTray, setShowAttachTray] = useState(false);

  const custom = settings.chatCustomizations?.[params.id];
  const nickname = custom?.nickname?.trim() ?? '';
  const displayName = nickname || params.peerName;
  const displayLabel = nickname ? `${displayName} (${params.peerName})` : displayName;

  const chatChannelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null);
  const keyPollRef = useRef(0);
  const listRef = useRef<FlatList>(null);
  const pendingIdRef = useRef(0);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const latestMessageAtRef = useRef<string | null>(null);
  const callSignalCursorRef = useRef<string | undefined>(undefined);
  const incomingPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!params.peerId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    keyPollRef.current = 0;
    setKeyTimedOut(false);
    setKeyError(false);

    const resolveFromKey = async (keyB64: string) => {
      const key = await getSharedKey(params.peerId, keyB64);
      if (!cancelled) { setSharedKey(key); setKeyWaiting(false); setKeyError(false); setKeyTimedOut(false); }
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
          if (keyPollRef.current >= MAX_KEY_POLLS) { if (!cancelled) { setKeyWaiting(false); setKeyTimedOut(true); } return; }
          if (!cancelled) pollTimer = setTimeout(pollUntilKey, 3000);
          return;
        }
        await resolveFromKey(keyB64);
      } catch { if (!cancelled) { setKeyError(true); setKeyWaiting(false); } }
    };

    if (params.peerKey) {
      resolveFromKey(params.peerKey).catch(() => {});
      fetchFromServer().then(serverKey => { if (!cancelled && serverKey && serverKey !== params.peerKey) resolveFromKey(serverKey).catch(() => {}); }).catch(() => {});
    } else { setKeyWaiting(true); pollUntilKey(); }

    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); };
  }, [params.peerId, params.peerKey, sessionToken, retryCount]);

  const decryptBatch = useCallback(async (msgs: Message[]): Promise<DecryptedMessage[]> => {
    if (!sharedKey) return msgs.map(m => ({ ...m, decryptedText: '🔒' }));
    return Promise.all(msgs.map(m => decryptOne(m, sharedKey)));
  }, [sharedKey]);

  useEffect(() => {
    if (!sharedKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const raw = await getMessages(params.id);
      if (cancelled) return;
      const dec = await decryptBatch(raw);
      setMessages(dec);
      knownMessageIdsRef.current = new Set(dec.map((m) => m.id));
      latestMessageAtRef.current = dec.length > 0 ? dec[0].created_at : null;
      setHasMore(raw.length === 50);
      setLoading(false);
      markRead(params.id).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [sharedKey, params.id, getMessages, decryptBatch, markRead]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !sharedKey || messages.length === 0) return;
    setLoadingMore(true);
    const oldest = messages[messages.length - 1].created_at;
    const raw = await getMessages(params.id, oldest);
    const dec = await decryptBatch(raw);
    setMessages(prev => [...prev, ...dec]);
    setHasMore(raw.length === 50);
    setLoadingMore(false);
  }, [loadingMore, hasMore, sharedKey, messages, params.id, getMessages, decryptBatch]);

  useEffect(() => {
    const sub = supabaseClient.channel(`chat-${params.id}`)
      .on('broadcast', { event: 'message_deleted' }, (payload: any) => {
        const { messageId } = payload.payload ?? {};
        if (messageId) setMessages(prev => prev.filter(m => m.id !== messageId));
      })
      .subscribe();
    chatChannelRef.current = sub;
    return () => { chatChannelRef.current = null; supabaseClient.removeChannel(sub); };
  }, [params.id]);

  useEffect(() => {
    if (!sharedKey) return;

    let cancelled = false;

    const poll = async () => {
      const after = latestMessageAtRef.current ?? undefined;
      const raw = await getMessages(params.id, undefined, after);
      if (cancelled || raw.length === 0) return;

      const dec = await decryptBatch(raw);
      if (cancelled) return;

      const newlySeen = dec.filter((m) => !knownMessageIdsRef.current.has(m.id));
      newlySeen.forEach((m) => knownMessageIdsRef.current.add(m.id));

      setMessages((prev) => {
        const next = [...prev];
        for (const incoming of dec) {
          const byId = next.findIndex((m) => m.id === incoming.id);
          if (byId !== -1) {
            next[byId] = { ...next[byId], ...incoming, pending: false, failed: false };
            continue;
          }
          const optimistic = next.findIndex(
            (m) => m.sender_id === incoming.sender_id && matchesPendingDirect(m, incoming),
          );
          if (optimistic !== -1) {
            next[optimistic] = { ...incoming, pending: false, failed: false };
            continue;
          }
          next.unshift(incoming);
        }
        return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });

      if (dec.length > 0) {
        const newest = dec[0].created_at;
        if (!latestMessageAtRef.current || new Date(newest) > new Date(latestMessageAtRef.current)) {
          latestMessageAtRef.current = newest;
        }
      }

      const peerNew = newlySeen.filter((m) => m.sender_id !== user?.id);
      if (peerNew.length > 0) {
        markRead(params.id).catch(() => {});
        setPeerTyping(false);
      }
    };

    const timer = setInterval(() => {
      poll().catch(() => {});
    }, CHAT_MESSAGE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sharedKey, params.id, user?.id, getMessages, decryptBatch, markRead]);

  useEffect(() => {
    const ch = supabaseClient.channel(`typing:${params.id}`)
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        if (payload.payload?.userId === user?.id) return;
        setPeerTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setPeerTyping(false), 3000);
      })
      .subscribe();
    typingChannelRef.current = ch;
    return () => { supabaseClient.removeChannel(ch); if (typingTimerRef.current) clearTimeout(typingTimerRef.current); };
  }, [params.id, user?.id]);

  useEffect(() => {
    if (!sessionToken || !params.peerId) return;
    (async () => {
      try {
        const res = await callAuthFunction({ action: 'get-username-history', sessionToken, userId: params.peerId });
        const history = (res?.history?.[params.peerId] ?? []).slice(0, 2);
        setPeerHistory(history);
      } catch {}
    })();
  }, [sessionToken, params.peerId]);

  const broadcastTyping = useCallback(() => {
    typingChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: user?.id } });
  }, [user?.id]);

  const openCallScreen = useCallback((incoming: boolean, callId?: string) => {
    if (!params.id || !params.peerId) return;
    router.push({
      pathname: '/call/[chatId]' as any,
      params: {
        chatId: params.id,
        peerId: params.peerId,
        peerName: params.peerName,
        peerAvatar: params.peerAvatar ?? '',
        peerKey: params.peerKey ?? '',
        incoming: incoming ? '1' : '0',
        callId: callId ?? '',
      },
    });
  }, [params.id, params.peerAvatar, params.peerId, params.peerKey, params.peerName, router]);

  const handleStartCall = useCallback(() => {
    if (!sharedKey) {
      Alert.alert('Secure channel not ready', 'Wait a moment for key sync, then start the call.');
      return;
    }
    openCallScreen(false);
  }, [openCallScreen, sharedKey]);

  useEffect(() => {
    if (!isFocused || !sessionToken || !sharedKey || !params.id || !params.peerId) return;
    let cancelled = false;

    const showIncomingPrompt = (signal: CallSignal) => {
      if (incomingPromptRef.current === signal.call_id) return;
      incomingPromptRef.current = signal.call_id;

      void showIncomingCallNotification({
        chatId: params.id,
        callId: signal.call_id,
        peerId: params.peerId,
        peerName: displayName,
        peerAvatar: params.peerAvatar ?? '',
      });

      Alert.alert(
        'Incoming secure call',
        `${displayName} is calling you.`,
        [
          {
            text: 'Decline',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await ackCallSignals([signal.id]);
                  await sendCallSignal(params.id, params.peerId, signal.call_id, 'decline', null);
                } catch {
                  // Ignore decline errors and unblock future prompts.
                } finally {
                  incomingPromptRef.current = null;
                }
              })();
            },
          },
          {
            text: 'Accept',
            onPress: () => {
              openCallScreen(true, signal.call_id);
            },
          },
        ],
        { cancelable: false },
      );
    };

    const pollCallSignals = async () => {
      try {
        const options: { since?: string } = {};
        if (callSignalCursorRef.current) options.since = callSignalCursorRef.current;
        const signals = await getCallSignals(params.id, options);
        if (signals.length === 0) return;

        const toAck: string[] = [];
        for (const signal of signals) {
          if (!callSignalCursorRef.current || new Date(signal.created_at) > new Date(callSignalCursorRef.current)) {
            callSignalCursorRef.current = signal.created_at;
          }

          if (signal.from_user_id !== params.peerId) {
            toAck.push(signal.id);
            continue;
          }

          if (signal.signal_type === 'offer') {
            showIncomingPrompt(signal);
            continue;
          }

          toAck.push(signal.id);
        }

        if (toAck.length > 0) {
          await ackCallSignals(toAck);
        }
      } catch {
        // Ignore transient polling failures.
      }
    };

    void pollCallSignals();
    const timer = setInterval(() => {
      if (!cancelled) void pollCallSignals();
    }, CALL_SIGNAL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    ackCallSignals,
    displayName,
    getCallSignals,
    isFocused,
    openCallScreen,
    params.id,
    params.peerId,
    sendCallSignal,
    sessionToken,
    sharedKey,
  ]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sharedKey || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText('');
    setSending(true);
    const tempId = `pending-${pendingIdRef.current++}`;
    const optimistic: DecryptedMessage = { id: tempId, chat_id: params.id, sender_id: user!.id, encrypted_body: '', msg_type: 'text', status: 'sent', created_at: new Date().toISOString(), decryptedText: text, pending: true };
    setMessages(prev => [optimistic, ...prev]);
    try {
      const enc = await encryptMessage(sharedKey, text);
      await apiSendMessage(params.id, enc, 'text');
    } catch {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m));
    } finally { setSending(false); }
  }, [inputText, sharedKey, sending, params.id, user, apiSendMessage]);

  const handleTakePhoto = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) { Alert.alert('Error', 'Could not read photo data.'); return; }
    setSending(true);
    try {
      const enc = await encryptMessage(sharedKey, JSON.stringify({ b64 }));
      const tempId = `pending-img-${pendingIdRef.current++}`;
      const optimistic: DecryptedMessage = { id: tempId, chat_id: params.id, sender_id: user!.id, encrypted_body: '', msg_type: 'image', status: 'sent', created_at: new Date().toISOString(), decryptedImageB64: b64, pending: true };
      setMessages(prev => [optimistic, ...prev]);
      await apiSendMessage(params.id, enc, 'image', { mimeType: 'image/jpeg' });
    } catch (e: any) { Alert.alert('Error', e.message ?? 'Could not send photo'); }
    finally { setSending(false); }
  }, [sharedKey, params.id, user, apiSendMessage]);

  const handlePickDocument = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 as any });
      const payload = { b64, name: asset.name, size: asset.size ?? 0, mimeType: asset.mimeType ?? 'application/octet-stream' };
      setSending(true);
      try {
        const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
        const tempId = `pending-file-${pendingIdRef.current++}`;
        const optimistic: DecryptedMessage = { id: tempId, chat_id: params.id, sender_id: user!.id, encrypted_body: '', msg_type: 'file', status: 'sent', created_at: new Date().toISOString(), decryptedFileData: payload, pending: true };
        setMessages(prev => [optimistic, ...prev]);
        await apiSendMessage(params.id, enc, 'file', { fileName: asset.name, fileSize: asset.size ?? 0, mimeType: asset.mimeType ?? 'application/octet-stream' });
      } catch (e: any) { Alert.alert('Error', e.message ?? 'Could not send file'); }
      finally { setSending(false); }
    } catch {}
  }, [sharedKey, params.id, user, apiSendMessage]);

  const handlePickImage = useCallback(async () => {
    if (!sharedKey) return;
    setShowAttachTray(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) { Alert.alert('Error', 'Could not read image data.'); return; }
    setSending(true);
    try {
      const enc = await encryptMessage(sharedKey, JSON.stringify({ b64 }));
      const tempId = `pending-img-${pendingIdRef.current++}`;
      const optimistic: DecryptedMessage = { id: tempId, chat_id: params.id, sender_id: user!.id, encrypted_body: '', msg_type: 'image', status: 'sent', created_at: new Date().toISOString(), decryptedImageB64: b64, pending: true };
      setMessages(prev => [optimistic, ...prev]);
      await apiSendMessage(params.id, enc, 'image', { mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch (e: any) { Alert.alert('Error', e.message ?? 'Could not send image'); }
    finally { setSending(false); }
  }, [sharedKey, params.id, user, apiSendMessage]);

  const handleFileOpen = useCallback(async (data: { b64: string; name: string; mimeType: string }) => {
    const writeAndShare = async (dialogTitle: string) => {
      const tmpPath = (FileSystem.cacheDirectory ?? '') + data.name;
      await FileSystem.writeAsStringAsync(tmpPath, data.b64, { encoding: 'base64' as any });
      await Sharing.shareAsync(tmpPath, { mimeType: data.mimeType, dialogTitle });
    };
    Alert.alert(data.name, data.mimeType, [
      { text: 'Open / Share', onPress: () => writeAndShare(data.name).catch(e => Alert.alert('Error', e.message)) },
      { text: 'Save to Downloads / Files', onPress: () => writeAndShare('Save ' + data.name).catch(e => Alert.alert('Error', e.message)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const handleDeleteForMe = useCallback((msg: DecryptedMessage) => { setMessages(prev => prev.filter(m => m.id !== msg.id)); }, []);

  const handleDeleteForAll = useCallback(async (msg: DecryptedMessage) => {
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    try {
      await deleteMessage(msg.id, true);
      chatChannelRef.current?.send({ type: 'broadcast', event: 'message_deleted', payload: { messageId: msg.id } });
    } catch (e: any) {
      setMessages(prev => { if (prev.some(m => m.id === msg.id)) return prev; return [...prev, msg].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); });
      Alert.alert('Error', e?.message ?? 'Could not delete message. Please try again.');
    }
  }, [deleteMessage]);

  const openForward = useCallback(async (src: { text?: string; b64?: string }) => {
    setForwardSrc(src);
    const all = await getChats().catch(() => []);
    setForwardChats(all.filter(c => c.chat_id !== params.id).map(c => ({ chat_id: c.chat_id, name: c.user.username, peerPublicKey: c.peer_public_key, peerId: c.user.id })));
    setShowForwardPicker(true);
  }, [getChats, params.id]);

  const handleForward = useCallback(async (toChatId: string, toPeerPublicKey: string, toPeerId: string) => {
    if (!forwardSrc) return;
    setForwarding(true);
    setShowForwardPicker(false);
    try {
      const toKey = await getSharedKey(toPeerId, toPeerPublicKey);
      if (forwardSrc.b64) { const enc = await encryptMessage(toKey, JSON.stringify({ b64: forwardSrc.b64 })); await apiSendMessage(toChatId, enc, 'image', { mimeType: 'image/jpeg' }); }
      else if (forwardSrc.text) { const enc = await encryptMessage(toKey, forwardSrc.text); await apiSendMessage(toChatId, enc, 'text'); }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { Alert.alert('Error', 'Could not forward message.'); }
    finally { setForwarding(false); setForwardSrc(null); }
  }, [forwardSrc, apiSendMessage]);

  const renderItem = useCallback(({ item, index }: { item: DecryptedMessage; index: number }) => {
    const isMe = item.sender_id === user?.id;
    const newer = messages[index - 1];
    const showSep = !newer || !sameDay(item.created_at, newer.created_at);
    return (
      <>
        {showSep && (
          <View style={styles.dateSepWrap}>
            <Text style={[styles.dateSepText, { color: subText, backgroundColor: bg }]}>{formatDateSep(item.created_at)}</Text>
          </View>
        )}
        <Bubble msg={item} isMe={isMe} accent={accent} muted={muted} bubble={bubble} bubbleMe={bubbleMe} textColor={textColor} textMe={textMe} timeColor={subText} onLongPress={(m) => setMenuMsg(m)} onImagePress={(b64) => setViewerImg(b64)} onFilePress={handleFileOpen} />
      </>
    );
  }, [messages, user?.id, accent, muted, bubble, bubbleMe, textColor, subText, bg, handleFileOpen]);

  if (keyTimedOut) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg, paddingBottom: 0, height: 56 + insets.top, paddingTop: insets.top }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{displayName}</Text>
        </View>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="key-alert-outline" size={48} color={subText} />
          <Text style={[styles.noKeyText, { color: subText, textAlign: 'center' }]}>{`${displayLabel} needs to open\nthe app to enable encryption.`}</Text>
          <Text style={{ color: subText, fontSize: 12, marginTop: 6, textAlign: 'center' }}>Ask them to open Privy, then tap Retry.</Text>
          <Pressable onPress={() => { setKeyTimedOut(false); setKeyWaiting(false); setRetryCount(c => c + 1); }} style={[styles.retryBtn, { backgroundColor: accent, marginTop: 20 }]}>
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (keyWaiting) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg, paddingBottom: 0, height: 56 + insets.top, paddingTop: insets.top }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{displayName}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={accent} size="large" />
          <Text style={[styles.noKeyText, { color: subText, marginTop: 16 }]}>{`Setting up secure channel\nwith ${displayLabel}…`}</Text>
          <Text style={{ color: subText, fontSize: 12, marginTop: 6 }}>Waiting for encryption key…</Text>
        </View>
      </View>
    );
  }

  if (keyError) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg, paddingBottom: 0, height: 56 + insets.top, paddingTop: insets.top }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
          </Pressable>
          <Text style={[styles.headerName, { color: textColor, marginLeft: 8 }]}>{displayName}</Text>
        </View>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="key-alert-outline" size={48} color={subText} />
          <Text style={[styles.noKeyText, { color: subText }]}>{"Could not establish\na secure connection."}</Text>
          <Pressable onPress={() => { setKeyError(false); setRetryCount(c => c + 1); }} style={[styles.retryBtn, { backgroundColor: accent }]}>
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Header - proper safe area handling */}
      <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg, paddingTop: insets.top, height: 56 + insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={textColor} />
        </Pressable>
        {params.peerAvatar ? (
          <Image source={{ uri: params.peerAvatar }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatarFallback, { backgroundColor: accent + '33' }]}>
            <Text style={[styles.avatarInitial, { color: accent }]}>{(params.peerName ?? '?')[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.headerName, { color: textColor }]} numberOfLines={1}>{displayName}</Text>
          {peerTyping ? (
            <View style={styles.typingRow}>
              <TypingDots color={accent} />
              <Text style={[styles.typingLabel, { color: accent }]}>typing…</Text>
            </View>
          ) : (
            <Text style={[styles.headerSub, { color: subText }]}>
              {nickname ? `Username: ${params.peerName} · ` : ''}
              End-to-end encrypted{peerHistory.length ? ` - previously ${peerHistory.join(', ')}` : ''}
            </Text>
          )}
        </View>
        <Pressable
          onPress={handleStartCall}
          style={[styles.callBtn, { backgroundColor: card, borderColor: border }]}
          hitSlop={8}
          disabled={!sharedKey}
        >
          <MaterialCommunityIcons name="phone-outline" size={20} color={!sharedKey ? subText : accent} />
        </Pressable>
        <MaterialCommunityIcons name="lock-outline" size={16} color={subText} style={{ marginRight: 4 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {loading ? (
          <View style={styles.centered}><ActivityIndicator color={accent} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, paddingTop: 8, flexGrow: 1, justifyContent: 'flex-end' }}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={accent} style={{ margin: 16 }} /> : null}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => Keyboard.dismiss()}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <MaterialCommunityIcons name="chat-outline" size={48} color={subText} />
                <Text style={[styles.emptyText, { color: subText }]}>No messages yet.{'\n'}Say hello! 👋</Text>
              </View>
            }
          />
        )}

        {/* Attach tray */}
        {showAttachTray && (
          <View style={[styles.attachTray, { backgroundColor: bg, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 8) }]}>
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

        {/* Input bar - always at bottom above keyboard */}
        <View style={[styles.inputBar, { borderTopColor: border, backgroundColor: bg, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable onPress={() => setShowAttachTray(v => !v)} style={[styles.attachBtn, { backgroundColor: card }]} hitSlop={8} disabled={sending || !sharedKey}>
            <MaterialCommunityIcons name={showAttachTray ? 'close' : 'plus'} size={22} color={showAttachTray ? accent : subText} />
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
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
          />
          <Pressable onPress={handleSend} disabled={!inputText.trim() || sending || !sharedKey} style={[styles.sendBtn, { backgroundColor: !inputText.trim() || !sharedKey ? card : accent }]}>
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="send" size={20} color={!inputText.trim() || !sharedKey ? subText : '#fff'} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Image viewer modal */}
      <ImageViewerModal visible={!!viewerImg} b64={viewerImg ?? ''} onClose={() => setViewerImg(null)} onForward={() => { const b64 = viewerImg; setViewerImg(null); if (b64) setTimeout(() => openForward({ b64 }), 200); }} insets={insets} />

      {/* Message action menu */}
      <MessageMenu visible={!!menuMsg} isMe={menuMsg?.sender_id === user?.id} msg={menuMsg} accent={accent} insets={insets} onClose={() => setMenuMsg(null)} onDeleteForMe={() => { if (menuMsg) handleDeleteForMe(menuMsg); setMenuMsg(null); }} onDeleteForAll={() => { if (menuMsg) handleDeleteForAll(menuMsg); setMenuMsg(null); }} onForward={() => { const m = menuMsg; setMenuMsg(null); if (m) setTimeout(() => { if (m.decryptedImageB64) openForward({ b64: m.decryptedImageB64 }); else if (m.decryptedText) openForward({ text: m.decryptedText }); }, 200); }} />

      {/* Forward picker */}
      {showForwardPicker && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { setShowForwardPicker(false); setForwardSrc(null); }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => { setShowForwardPicker(false); setForwardSrc(null); }}>
            <Pressable style={[mmStyles.sheet, { backgroundColor: card, paddingBottom: insets.bottom + 12, maxHeight: '60%' }]}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: textColor, marginBottom: 12 }}>Forward to…</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {forwardChats.map(c => (
                  <Pressable key={c.chat_id} style={({ pressed }) => [mmStyles.item, pressed && { opacity: 0.6 }]} onPress={() => c.peerPublicKey && handleForward(c.chat_id, c.peerPublicKey, c.peerId)}>
                    <MaterialCommunityIcons name="account-circle-outline" size={28} color={accent} />
                    <Text style={[mmStyles.itemText, { color: textColor }]}>{c.name}</Text>
                    {!c.peerPublicKey && <Text style={{ color: '#9CA3AF', fontSize: 12 }}>No key</Text>}
                  </Pressable>
                ))}
                {forwardChats.length === 0 && <Text style={[mmStyles.itemText, { color: '#9CA3AF', textAlign: 'center', paddingVertical: 24 }]}>No other chats</Text>}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Forwarding spinner overlay */}
      {forwarding && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { marginRight: 4, paddingVertical: 8 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: 16, fontWeight: '700' },
  headerName: { fontSize: 16, fontWeight: '600' },
  headerSub: { fontSize: 11, marginTop: 1 },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  bubbleWrap: { marginVertical: 2 },
  bubbleLeft: { alignItems: 'flex-start' },
  bubbleRight: { alignItems: 'flex-end' },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 6 },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgImage: { width: 220, height: 180, borderRadius: 12 },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  timeText: { fontSize: 11 },
  dateSepWrap: { alignItems: 'center', marginVertical: 10 },
  dateSepText: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  emptyWrap: { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 22 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  attachBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  attachTray: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  trayBtn: { alignItems: 'center', gap: 6, width: 80, paddingVertical: 12, borderRadius: 14 },
  trayLabel: { fontSize: 12 },
  fileCard: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 280, minWidth: 210 },
  fileCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileIconCircle: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  fileCardInfo: { flex: 1, gap: 2 },
  fileNameTxt: { fontSize: 13, fontWeight: '600', lineHeight: 17 },
  fileMetaTxt: { fontSize: 11 },
  fileStatusTxt: { fontSize: 11 },
  callEventCard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 180,
    maxWidth: 290,
  },
  callEventHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  callEventTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  callEventSub: {
    fontSize: 11,
    marginTop: 3,
  },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  noKeyText: { textAlign: 'center', fontSize: 14, lineHeight: 22, marginHorizontal: 32 },
  retryBtn: { marginTop: 16, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  typingLabel: { fontSize: 12 },
  typingDotsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  typingDot: { width: 5, height: 5, borderRadius: 3 },
});