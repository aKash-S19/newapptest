import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
    PermissionsAndroid,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, type CallSignal, type CallSignalType } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { decryptMessage, encryptMessage, getSharedKey } from '@/lib/e2ee';
import { callAuthFunction } from '@/lib/supabase';

declare function require(moduleName: string): any;

type CallPhase = 'preparing' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';

type SignalDescription = {
  type: string;
  sdp?: string;
};

type SignalIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type ExternalCallPayload = {
  mode: 'external';
  provider: 'talky';
  room: string;
};

type MediaTrackLike = {
  enabled: boolean;
  stop: () => void;
};

type MediaStreamLike = {
  getTracks: () => MediaTrackLike[];
  getAudioTracks: () => MediaTrackLike[];
};

type PeerConnectionLike = {
  connectionState: string;
  remoteDescription: SignalDescription | null;
  onicecandidate: ((event: { candidate: { toJSON?: () => SignalIceCandidate } | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack: (track: MediaTrackLike, stream: MediaStreamLike) => void;
  createOffer: (options?: Record<string, unknown>) => Promise<SignalDescription>;
  createAnswer: () => Promise<SignalDescription>;
  setLocalDescription: (description: SignalDescription) => Promise<void>;
  setRemoteDescription: (description: SignalDescription) => Promise<void>;
  addIceCandidate: (candidate: SignalIceCandidate) => Promise<void>;
  close: () => void;
};

type WebRtcModule = {
  mediaDevices: {
    getUserMedia: (constraints: { audio: boolean; video: boolean }) => Promise<MediaStreamLike>;
  };
  RTCPeerConnection: new (config: {
    iceServers: {
      urls: string | string[];
      username?: string;
      credential?: string;
    }[];
  }) => PeerConnectionLike;
  RTCSessionDescription: new (description: SignalDescription) => SignalDescription;
  RTCIceCandidate: new (candidate: SignalIceCandidate) => SignalIceCandidate;
};

const STUN_SERVERS: { urls: string | string[]; username?: string; credential?: string }[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
];

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function parseCsv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const turnUrls = parseCsv(extra.turnUrls);
  const turnUsername = typeof extra.turnUsername === 'string' ? extra.turnUsername.trim() : '';
  const turnCredential = typeof extra.turnCredential === 'string' ? extra.turnCredential.trim() : '';

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    return [
      {
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      },
      ...STUN_SERVERS,
    ];
  }

  return STUN_SERVERS;
}

const ICE_SERVERS = buildIceServers();

const CONNECT_TIMEOUT_MS = 45_000;
const CALL_SIGNAL_POLL_MS = 600;
const CALL_MODE: 'native' | 'external' = 'external';

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function createCallId(): string {
  return ExpoCrypto.randomUUID();
}

function createExternalRoom(chatId: string, callId: string): string {
  const safeChat = chatId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'chat';
  const safeCall = callId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'call';
  return `privy-${safeChat}-${safeCall}`.toLowerCase();
}

function getExternalCallUrl(room: string): string {
  return `https://talky.io/${encodeURIComponent(room)}`;
}

function isExternalCallPayload(value: unknown): value is ExternalCallPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<ExternalCallPayload>;
  return payload.mode === 'external' && payload.provider === 'talky' && typeof payload.room === 'string' && payload.room.trim().length > 0;
}

function isSignalDescription(value: unknown): value is SignalDescription {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<SignalDescription>;
  return typeof maybe.type === 'string' && ['offer', 'answer', 'pranswer', 'rollback'].includes(maybe.type);
}

function getErrorText(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) return msg;
  }
  return '';
}

function isMicrophonePermissionError(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();
  return (
    message.includes('mic_permission_denied') ||
    message.includes('permission denied') ||
    message.includes('record_audio') ||
    message.includes('microphone')
  );
}

function getCallStartErrorMessage(error: unknown): string {
  if (isMicrophonePermissionError(error)) {
    return 'Microphone permission is required for calls. Enable it and try again.';
  }

  const message = getErrorText(error);
  if (!message) {
    return 'Unable to start call right now. Please try again.';
  }

  if (
    message.toLowerCase().includes('voice calls are only available in 1:1 chats') ||
    message.toLowerCase().includes('not a member of this chat') ||
    message.toLowerCase().includes('missing fields') ||
    message.toLowerCase().includes('not available at the moment')
  ) {
    return message;
  }

  return `Unable to start call: ${message}`;
}

export default function CallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const th = useAppTheme();
  const params = useLocalSearchParams<{
    chatId: string;
    peerId: string;
    peerName?: string;
    peerAvatar?: string;
    peerKey?: string;
    incoming?: string;
    callId?: string;
  }>();

  const {
    sessionToken,
    sendCallSignal,
    getCallSignals,
    ackCallSignals,
  } = useAuth();

  const chatId = String(params.chatId ?? '');
  const peerId = String(params.peerId ?? '');
  const peerName = String(params.peerName ?? 'Unknown user');
  const peerAvatar = String(params.peerAvatar ?? '');
  const incomingMode = String(params.incoming ?? '') === '1';

  const [phase, setPhase] = useState<CallPhase>('preparing');
  const [statusText, setStatusText] = useState(incomingMode ? 'Waiting for caller...' : 'Starting secure call...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sharedKey, setSharedKey] = useState<Uint8Array | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [ending, setEnding] = useState(false);

  const rtc = useMemo<WebRtcModule | null>(() => {
    try {
      return require('react-native-webrtc') as WebRtcModule;
    } catch {
      return null;
    }
  }, []);

  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  const callIdRef = useRef(String(params.callId ?? ''));
  const signalCursorRef = useRef<string | undefined>(undefined);
  const pcRef = useRef<PeerConnectionLike | null>(null);
  const localStreamRef = useRef<MediaStreamLike | null>(null);
  const pendingIceRef = useRef<SignalIceCandidate[]>([]);
  const externalRoomRef = useRef<string | null>(null);
  const externalOpenedRef = useRef(false);
  const bootedRef = useRef(false);
  const offerHandledRef = useRef(false);
  const historyLoggedRef = useRef(false);
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);

  const teardownConnection = useCallback(() => {
    try {
      pcRef.current?.close();
    } catch {
      // Best effort close.
    }
    pcRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore stop errors from already-ended tracks.
        }
      });
    }
    localStreamRef.current = null;
    pendingIceRef.current = [];
  }, []);

  const ensureMicrophonePermission = useCallback(async (): Promise<void> => {
    if (Platform.OS !== 'android') return;

    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) return;

    const result = await PermissionsAndroid.request(permission, {
      title: 'Allow microphone access',
      message: 'Privy needs microphone access for secure voice calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });

    if (result === PermissionsAndroid.RESULTS.GRANTED) return;

    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Microphone permission needed',
        'Microphone access is blocked. Enable it in app settings to start calls.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => { void Linking.openSettings(); } },
        ],
      );
    }

    throw new Error('MIC_PERMISSION_DENIED');
  }, []);

  const sendSignal = useCallback(async (
    signalType: CallSignalType,
    payload?: SignalDescription | SignalIceCandidate | ExternalCallPayload | null,
  ) => {
    if (!chatId || !peerId) throw new Error('Missing call participants.');
    if (!callIdRef.current) callIdRef.current = createCallId();

    let encryptedPayload: string | null = null;
    if (payload !== undefined && payload !== null) {
      if (!sharedKey) throw new Error('Secure key is not ready.');
      encryptedPayload = await encryptMessage(sharedKey, JSON.stringify(payload));
    }

    await sendCallSignal(
      chatId,
      peerId,
      callIdRef.current,
      signalType,
      encryptedPayload,
    );
  }, [chatId, peerId, sendCallSignal, sharedKey]);

  const appendCallHistory = useCallback(async (kind: 'completed' | 'missed' | 'declined' | 'busy') => {
    if (historyLoggedRef.current) return;
    if (!sharedKey || !chatId || !sessionToken || !callIdRef.current) return;

    const durationSeconds = connectedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
      : 0;

    historyLoggedRef.current = true;
    try {
      const payload = JSON.stringify({
        kind: 'call_event',
        status: kind,
        durationSeconds,
        createdAt: new Date().toISOString(),
      });
      const encryptedHistory = await encryptMessage(sharedKey, payload);
      await callAuthFunction({
        action: 'log-call-event',
        sessionToken,
        chatId,
        callId: callIdRef.current,
        status: kind,
        durationSeconds,
        encryptedBody: encryptedHistory,
      });
    } catch {
      // Do not block call teardown when logging history fails.
    }
  }, [chatId, sessionToken, sharedKey]);

  const applyQueuedIce = useCallback(async () => {
    if (!rtc) return;
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription || pendingIceRef.current.length === 0) return;
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new rtc.RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidates.
      }
    }
  }, [rtc]);

  const ensurePeerConnection = useCallback(async (): Promise<PeerConnectionLike> => {
    if (CALL_MODE !== 'native') throw new Error('Native PeerConnection is disabled for this build.');
    if (!rtc) throw new Error('WebRTC runtime is unavailable.');
    if (pcRef.current) return pcRef.current;

    await ensureMicrophonePermission();

    let pc: PeerConnectionLike;
    try {
      pc = new rtc.RTCPeerConnection({ iceServers: ICE_SERVERS });
    } catch (iceConfigError) {
      // If TURN values are malformed for this runtime, fall back to STUN-only setup.
      pc = new rtc.RTCPeerConnection({ iceServers: STUN_SERVERS });
      console.warn('[call] TURN/STUN init failed, using STUN fallback', getErrorText(iceConfigError));
    }
    pc.onicecandidate = (event) => {
      if (!event.candidate || endedRef.current) return;
      const payload = event.candidate.toJSON ? event.candidate.toJSON() : null;
      if (!payload) return;
      void sendSignal('ice', payload).catch(() => {
        // Keep the call alive even if one candidate fails to send.
      });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setPhase('connected');
        setStatusText('Secure voice call');
        connectedAtRef.current = Date.now();
        return;
      }
      if (state === 'disconnected' && !endedRef.current) {
        setPhase('connecting');
        setStatusText('Reconnecting...');
        return;
      }
      if ((state === 'failed' || state === 'closed') && !endedRef.current) {
        setPhase('failed');
        setErrorMessage('Call connection failed.');
      }
    };

    const stream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
    localStreamRef.current = stream;
    pcRef.current = pc;

    return pc;
  }, [ensureMicrophonePermission, rtc, sendSignal]);

  const openExternalCall = useCallback(async (room: string) => {
    const normalizedRoom = room.trim();
    if (!normalizedRoom || externalOpenedRef.current) return;

    externalOpenedRef.current = true;
    externalRoomRef.current = normalizedRoom;
    setPhase('connected');
    setStatusText('Connected via internet call');

    try {
      await WebBrowser.openBrowserAsync(getExternalCallUrl(normalizedRoom));
    } catch {
      setPhase('failed');
      setErrorMessage('Could not open internet call room.');
      return;
    } finally {
      externalOpenedRef.current = false;
    }

    if (!endedRef.current && callIdRef.current) {
      await appendCallHistory('completed');
      endedRef.current = true;
      teardownConnection();
      setPhase('ended');
      setStatusText('Call ended');
      await sendSignal('end').catch(() => {
        // Ignore remote signal errors on browser close.
      });
    }

    router.back();
  }, [appendCallHistory, router, sendSignal, teardownConnection]);

  const processSignal = useCallback(async (signal: CallSignal) => {
    if (CALL_MODE === 'native' && !rtc) return;
    if (signal.from_user_id !== peerId) return;

    if (callIdRef.current && signal.call_id !== callIdRef.current) {
      return;
    }
    if (!callIdRef.current) {
      callIdRef.current = signal.call_id;
    }

    if (signal.signal_type === 'offer') {
      if (offerHandledRef.current) return;
      if (!signal.signal_payload || !sharedKey) return;

      offerHandledRef.current = true;
      const decoded = await decryptMessage(sharedKey, signal.signal_payload);
      const remoteOfferRaw = JSON.parse(decoded) as unknown;

      if (isExternalCallPayload(remoteOfferRaw)) {
        await sendSignal('answer', {
          mode: 'external',
          provider: 'talky',
          room: remoteOfferRaw.room,
        });
        await openExternalCall(remoteOfferRaw.room);
        return;
      }

      if (CALL_MODE !== 'native') {
        throw new Error('Unsupported call offer payload for external mode.');
      }
      if (!isSignalDescription(remoteOfferRaw)) {
        throw new Error('Unsupported call offer payload.');
      }
      const remoteOffer = remoteOfferRaw as SignalDescription;

      const pc = await ensurePeerConnection();
      await pc.setRemoteDescription(new rtc.RTCSessionDescription(remoteOffer));
      await applyQueuedIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal('answer', answer);

      setPhase('connecting');
      setStatusText('Connecting...');
      return;
    }

    if (signal.signal_type === 'answer') {
      if (!signal.signal_payload || !sharedKey) return;

      const decoded = await decryptMessage(sharedKey, signal.signal_payload);
      const remoteAnswerRaw = JSON.parse(decoded) as unknown;

      if (isExternalCallPayload(remoteAnswerRaw)) {
        await openExternalCall(remoteAnswerRaw.room);
        return;
      }

      if (CALL_MODE !== 'native') {
        throw new Error('Unsupported call answer payload for external mode.');
      }
      if (!isSignalDescription(remoteAnswerRaw)) {
        throw new Error('Unsupported call answer payload.');
      }

      const pc = pcRef.current;
      const remoteAnswer = remoteAnswerRaw as SignalDescription;

      if (!pc) return;

      await pc.setRemoteDescription(new rtc.RTCSessionDescription(remoteAnswer));
      await applyQueuedIce();
      setPhase('connecting');
      setStatusText('Connecting...');
      return;
    }

    if (signal.signal_type === 'ice') {
      if (CALL_MODE !== 'native') return;
      if (!signal.signal_payload || !sharedKey) return;
      const decoded = await decryptMessage(sharedKey, signal.signal_payload);
      const candidate = JSON.parse(decoded) as SignalIceCandidate;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new rtc.RTCIceCandidate(candidate));
      } catch {
        // Ignore stale/bad candidates.
      }
      return;
    }

    if (signal.signal_type === 'decline') {
      await appendCallHistory('declined');
      endedRef.current = true;
      setPhase('ended');
      setStatusText('Call declined');
      teardownConnection();
      return;
    }

    if (signal.signal_type === 'busy') {
      await appendCallHistory('busy');
      endedRef.current = true;
      setPhase('ended');
      setStatusText('User is busy');
      teardownConnection();
      return;
    }

    if (signal.signal_type === 'end') {
      if (connectedAtRef.current) await appendCallHistory('completed');
      else await appendCallHistory('missed');
      endedRef.current = true;
      setPhase('ended');
      setStatusText('Call ended');
      teardownConnection();
    }
  }, [appendCallHistory, applyQueuedIce, ensurePeerConnection, openExternalCall, peerId, rtc, sendSignal, sharedKey, teardownConnection]);

  const pollSignals = useCallback(async () => {
    const options: { since?: string; callId?: string } = {};
    if (signalCursorRef.current) options.since = signalCursorRef.current;
    if (callIdRef.current) options.callId = callIdRef.current;

    const signals = await getCallSignals(chatId, options);
    if (!signals.length) return;

    const ackIds: string[] = [];
    for (const signal of signals) {
      if (!signalCursorRef.current || new Date(signal.created_at) > new Date(signalCursorRef.current)) {
        signalCursorRef.current = signal.created_at;
      }
      ackIds.push(signal.id);
      try {
        await processSignal(signal);
      } catch (error) {
        setPhase('failed');
        setErrorMessage(getCallStartErrorMessage(error));
      }
    }

    if (ackIds.length > 0) {
      await ackCallSignals(ackIds);
    }
  }, [ackCallSignals, chatId, getCallSignals, processSignal]);

  const endCall = useCallback(async (notifyPeer: boolean, message: string) => {
    if (ending) return;
    setEnding(true);

    if (notifyPeer && !endedRef.current && callIdRef.current) {
      try {
        await sendSignal('end');
      } catch {
        // Remote end-signal failure should not block local teardown.
      }
    }

    if (message === 'No answer') {
      await appendCallHistory('missed');
    } else if (message === 'Call ended') {
      if (connectedAtRef.current) await appendCallHistory('completed');
      else await appendCallHistory('missed');
    }

    endedRef.current = true;
    teardownConnection();
    setPhase('ended');
    setStatusText(message);
    setEnding(false);
  }, [appendCallHistory, ending, sendSignal, teardownConnection]);

  const leaveScreen = useCallback(async () => {
    await endCall(true, 'Call ended');
    router.back();
  }, [endCall, router]);

  useEffect(() => {
    if (!chatId || !peerId) {
      setPhase('failed');
      setErrorMessage('Missing call information.');
      return;
    }

    if (!sessionToken) {
      setPhase('failed');
      setErrorMessage('You must be logged in to start a call.');
      return;
    }

    let cancelled = false;
    const loadSharedKey = async () => {
      try {
        let key = String(params.peerKey ?? '').trim();
        if (!key) {
          const res = await callAuthFunction({ action: 'get-public-key', sessionToken, userId: peerId });
          key = String(res?.publicKey ?? '').trim();
        }
        if (!key) throw new Error('Peer encryption key is unavailable.');

        const derived = await getSharedKey(peerId, key);
        if (!cancelled) {
          setSharedKey(derived);
          setErrorMessage(null);
        }
      } catch {
        if (!cancelled) {
          setPhase('failed');
          setErrorMessage('Could not establish secure signaling key.');
        }
      }
    };

    void loadSharedKey();
    return () => {
      cancelled = true;
    };
  }, [chatId, params.peerKey, peerId, sessionToken]);

  useEffect(() => {
    if (!sharedKey || !chatId || !peerId || bootedRef.current) return;
    if (CALL_MODE === 'native' && !rtc) return;
    bootedRef.current = true;

    let cancelled = false;

    const startOutgoing = async () => {
      try {
        if (!callIdRef.current) callIdRef.current = createCallId();

        if (CALL_MODE === 'external') {
          const room = createExternalRoom(chatId, callIdRef.current);
          externalRoomRef.current = room;
          await sendSignal('offer', {
            mode: 'external',
            provider: 'talky',
            room,
          });
          if (!cancelled) {
            setPhase('ringing');
            setStatusText('Opening internet call...');
          }
          await openExternalCall(room);
          return;
        }

        const pc = await ensurePeerConnection();
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        await sendSignal('offer', offer);
        if (!cancelled) {
          setPhase('ringing');
          setStatusText('Ringing...');
        }
      } catch (error) {
        if (!cancelled) {
          setPhase('failed');
          setErrorMessage(getCallStartErrorMessage(error));
        }
      }
    };

    if (incomingMode) {
      if (!callIdRef.current) callIdRef.current = String(params.callId ?? '');
      setPhase('connecting');
      setStatusText('Waiting for caller...');
    } else {
      void startOutgoing();
    }

    return () => {
      cancelled = true;
    };
  }, [chatId, ensurePeerConnection, incomingMode, params.callId, peerId, rtc, sendSignal, sharedKey]);

  useEffect(() => {
    if (!sharedKey || !chatId || !peerId || !sessionToken) return;
    let cancelled = false;

    const run = async () => {
      try {
        await pollSignals();
      } catch {
        // Ignore transient polling failures.
      }
    };

    void run();
    const timer = setInterval(() => {
      if (!cancelled) void run();
    }, CALL_SIGNAL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chatId, peerId, pollSignals, sessionToken, sharedKey]);

  useEffect(() => {
    if (phase === 'connected') {
      if (!connectedAtRef.current) connectedAtRef.current = Date.now();
      const timer = setInterval(() => {
        if (!connectedAtRef.current) return;
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000)));
      }, 1000);
      return () => clearInterval(timer);
    }
    if (phase !== 'ended') {
      connectedAtRef.current = null;
      setElapsedSeconds(0);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (phase !== 'ringing' && phase !== 'connecting') return;
    const timeout = setTimeout(() => {
      if (endedRef.current) return;
      void endCall(true, 'No answer');
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [endCall, phase]);

  useEffect(() => {
    return () => {
      teardownConnection();
    };
  }, [teardownConnection]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }, [muted]);

  const statusLabel = useMemo(() => {
    if (errorMessage) return errorMessage;
    if (phase === 'connected') return `Secure voice call • ${formatDuration(elapsedSeconds)}`;
    return statusText;
  }, [elapsedSeconds, errorMessage, phase, statusText]);

  const showOpenSettings = useMemo(() => {
    if (!errorMessage) return false;
    return errorMessage.toLowerCase().includes('microphone permission');
  }, [errorMessage]);

  if (isExpoGo && CALL_MODE === 'native') {
    return (
      <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top }]}> 
        <View style={[styles.header, { borderBottomColor: th.border }]}> 
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={th.textDark} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: th.textDark }]}>Voice call</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.centered}> 
          <MaterialCommunityIcons name="information-outline" size={44} color={th.textSoft} />
          <Text style={[styles.infoText, { color: th.textSoft }]}>Voice calls require a development build. Expo Go does not include react-native-webrtc.</Text>
        </View>
      </View>
    );
  }

  if (!rtc && CALL_MODE === 'native') {
    return (
      <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top }]}> 
        <View style={[styles.header, { borderBottomColor: th.border }]}> 
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={th.textDark} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: th.textDark }]}>Voice call</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.centered}> 
          <MaterialCommunityIcons name="alert-circle-outline" size={44} color={th.error} />
          <Text style={[styles.infoText, { color: th.textSoft }]}>react-native-webrtc is unavailable. Rebuild the app with native dependencies installed.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top }]}> 
      <View style={[styles.header, { borderBottomColor: th.border }]}> 
        <Pressable onPress={() => { void leaveScreen(); }} style={styles.iconBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={th.textDark} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: th.textDark }]}>Voice call</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.centered}> 
        {peerAvatar ? (
          <Image source={{ uri: peerAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: `${th.accent}33` }]}>
            <Text style={[styles.avatarInitial, { color: th.accent }]}>{peerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <Text style={[styles.peerName, { color: th.textDark }]} numberOfLines={1}>{peerName}</Text>

        <View style={styles.statusRow}>
          {phase !== 'connected' && phase !== 'ended' && phase !== 'failed' ? (
            <ActivityIndicator size="small" color={th.accent} />
          ) : null}
          <Text style={[styles.statusText, { color: errorMessage ? th.error : th.textSoft }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 20) }]}> 
        {CALL_MODE === 'native' && (
          <Pressable
            onPress={toggleMute}
            style={[styles.controlBtn, { backgroundColor: th.cardBg, borderColor: th.border }]}
            disabled={phase === 'ended' || phase === 'failed'}
          >
            <MaterialCommunityIcons
              name={muted ? 'microphone-off' : 'microphone'}
              size={24}
              color={muted ? th.error : th.textDark}
            />
            <Text style={[styles.controlLabel, { color: th.textSoft }]}>{muted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => { void leaveScreen(); }}
          style={[styles.controlBtn, styles.endBtn]}
          disabled={ending}
        >
          <MaterialCommunityIcons name="phone-hangup" size={24} color="#fff" />
          <Text style={[styles.controlLabel, { color: '#fff' }]}>{ending ? 'Ending...' : 'End'}</Text>
        </Pressable>
      </View>

      {(phase === 'failed' || phase === 'ended') && (
        <View style={styles.overlay}> 
          {showOpenSettings && (
            <Pressable
              onPress={() => { void Linking.openSettings(); }}
              style={[styles.closeBtn, { backgroundColor: '#111827', marginBottom: 10 }]}
            >
              <Text style={styles.closeBtnText}>Open settings</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => router.back()}
            style={[styles.closeBtn, { backgroundColor: th.accent }]}
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  avatarFallback: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 44,
    fontWeight: '700',
  },
  peerName: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  controls: {
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  controlBtn: {
    width: 110,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  endBtn: {
    backgroundColor: '#E23B3B',
    borderColor: '#E23B3B',
  },
  controlLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 24,
  },
  closeBtn: {
    minWidth: 140,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
