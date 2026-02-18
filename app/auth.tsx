import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmojiGrid } from '@/components/auth/EmojiGrid';
import { EmojiSlots } from '@/components/auth/EmojiSlots';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { useAuth } from '@/contexts/AuthContext';

type Mode = 'create' | 'login';
const MAX_EMOJIS = 4;
// useNativeDriver is unsupported on web — fall back to JS-driven animations
const ND = Platform.OS !== 'web';

export default function AuthScreen() {
  const { register, login } = useAuth();
  const [mode, setMode] = useState<Mode>('create');
  const [username, setUsername] = useState('');
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ─── Entrance animations ──────────────────────────────────────────
  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(36)).current;
  const brandScale = useRef(new Animated.Value(0.85)).current;

  // ─── Shake animation ──────────────────────────────────────────────
  const shakeX = useRef(new Animated.Value(0)).current;

  // ─── Mode switch fade ─────────────────────────────────────────────
  const cardOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: ND,
      }),
      Animated.spring(screenSlide, {
        toValue: 0,
        useNativeDriver: ND,
        speed: 10,
        bounciness: 6,
      }),
      Animated.spring(brandScale, {
        toValue: 1,
        useNativeDriver: ND,
        speed: 8,
        bounciness: 14,
        delay: 200,
      } as any),
    ]).start();
  }, []);

  // ─── Handlers ─────────────────────────────────────────────────────
  const shake = useCallback(() => {
    setHasError(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -12, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue: 12, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue: -9, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue: 9, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue: -5, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue: 0, duration: 55, useNativeDriver: ND }),
    ]).start();
    setTimeout(() => setHasError(false), 1600);
  }, [shakeX]);

  const handleEmojiPress = useCallback((emoji: string) => {
    setHasError(false);
    setSelectedEmojis((prev) => {
      if (prev.length >= MAX_EMOJIS) return prev;
      return [...prev, emoji];
    });
  }, []);

  const handleRemoveLast = useCallback(() => {
    setHasError(false);
    setSelectedEmojis((prev) => prev.slice(0, -1));
  }, []);

  const handleConfirm = useCallback(async () => {
    setServerError(null);

    if (!username.trim()) {
      setServerError('Please enter a username.');
      shake();
      return;
    }
    if (selectedEmojis.length < MAX_EMOJIS) {
      shake();
      return;
    }

    setIsLoading(true);
    try {
      if (mode === 'create') {
        await register(username.trim(), selectedEmojis);
      } else {
        await login(username.trim(), selectedEmojis);
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      setServerError(err.message ?? 'Something went wrong');
      shake();
    } finally {
      setIsLoading(false);
    }
  }, [username, selectedEmojis, mode, register, login, shake]);

  const handleModeSwitch = useCallback(() => {
    // Fade out → swap → fade in
    Animated.timing(cardOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: ND,
    }).start(() => {
      setSelectedEmojis([]);
      setHasError(false);
      setServerError(null);
      setMode((m) => (m === 'create' ? 'login' : 'create'));
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: ND,
      }).start();
    });
  }, [cardOpacity]);

  const isCreate = mode === 'create';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Soft background blobs */}
      <View style={styles.blobTopRight} />
      <View style={styles.blobBottomLeft} />

      <Animated.View
        style={[
          styles.screen,
          { opacity: screenOpacity, transform: [{ translateY: screenSlide }] },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Branding ── */}
          <Animated.View style={[styles.branding, { transform: [{ scale: brandScale }] }]}>
            <View style={styles.lockWrapper}>
              <View style={styles.lockCard}>
                <Text style={styles.lockIcon}>🔒</Text>
              </View>
            </View>
            <Text style={styles.appName}>Privy</Text>
            <Text style={styles.tagline}>Private by Design.</Text>
            <Text style={styles.micro}>No phone. No email. No tracking.</Text>
          </Animated.View>

          {/* ── Main Clay Card ── */}
          <Animated.View
            style={[
              styles.card,
              hasError && styles.cardError,
              { opacity: cardOpacity, transform: [{ translateX: shakeX }] },
            ]}
          >
            {/* Card Header */}
            <Text style={styles.cardTitle}>
              {isCreate ? 'Create Your Emoji Key' : 'Welcome Back'}
            </Text>
            <Text style={styles.cardDesc}>
              {isCreate
                ? 'Pick 4 emojis in order.\nThat\u2019s your secure identity.'
                : 'Enter your 4-emoji key to unlock Privy.'}
            </Text>

            {/* Username field */}
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.usernameInput}
                placeholder="Choose a username"
                placeholderTextColor={TEXT_SOFT}
                value={username}
                onChangeText={(v) => { setUsername(v); setServerError(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
                editable={!isLoading}
              />
            </View>

            {/* Slots */}
            <View style={styles.slotsContainer}>
              <EmojiSlots selected={selectedEmojis} total={MAX_EMOJIS} />
            </View>

            {/* Grid */}
            <View style={styles.gridContainer}>
              <EmojiGrid onEmojiPress={handleEmojiPress} />
            </View>

            {/* Remove last / Clear row */}
            <View style={styles.actionRow}>
              {selectedEmojis.length > 0 && (
                <Pressable onPress={handleRemoveLast} style={styles.chipBtn}>
                  <Text style={styles.chipText}>⌫  Remove last</Text>
                </Pressable>
              )}
              {selectedEmojis.length === MAX_EMOJIS && (
                <Pressable
                  onPress={() => setSelectedEmojis([])}
                  style={[styles.chipBtn, styles.chipDanger]}
                >
                  <Text style={[styles.chipText, styles.chipTextDanger]}>✕  Clear all</Text>
                </Pressable>
              )}
            </View>

            {/* Error hints */}
            {(hasError || serverError) && (
              <View style={styles.errorBadge}>
                <Text style={styles.errorText}>
                  {serverError ?? 'Select all 4 emojis first 👆'}
                </Text>
              </View>
            )}
          </Animated.View>

          {/* ── Microcopy ── */}
          <View style={styles.microcopyBlock}>
            <Text style={styles.microcopyLine}>🔐  Your key stays on your device.</Text>
            <Text style={styles.microcopyLine}>✨  Only you control your identity.</Text>
          </View>

          {/* ── CTA ── */}
          <View style={styles.ctaContainer}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={styles.loadingText}>
                  {isCreate ? 'Creating your identity…' : 'Verifying your key…'}
                </Text>
              </View>
            ) : (
              <PrimaryButton
                label={isCreate ? 'Secure My Identity' : 'Unlock Privy'}
                onPress={handleConfirm}
                disabled={selectedEmojis.length < MAX_EMOJIS || !username.trim()}
              />
            )}
          </View>

          {/* ── Secondary ── */}
          <Pressable onPress={handleModeSwitch} style={styles.secondaryBtn}>
            <Text style={styles.secondaryText}>
              {isCreate ? 'I Already Have an Emoji Key' : 'Create a New Identity'}
            </Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const BG = '#F4F6F8';
const CARD_BG = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_MED = '#5A7182';
const TEXT_SOFT = '#8FA3B1';
const ACCENT = '#4CAF82';
const ERROR = '#FF5F6D';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  // Decorative background blobs
  blobTopRight: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(76,175,130,0.07)',
    pointerEvents: 'none',
  },
  blobBottomLeft: {
    position: 'absolute',
    bottom: -100,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(92,155,214,0.07)',
    pointerEvents: 'none',
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 48,
    alignItems: 'center',
  },

  // ── Branding ──────────────────────────────────────────────────────
  branding: {
    alignItems: 'center',
    marginBottom: 28,
  },
  lockWrapper: {
    marginBottom: 14,
  },
  lockCard: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.95)',
    ...Platform.select({
      web: { boxShadow: '0px 8px 16px rgba(123,158,192,0.28)' } as any,
      default: {
        shadowColor: '#7B9EC0',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 16,
        elevation: 10,
      },
    }),
  },
  lockIcon: {
    fontSize: 34,
    includeFontPadding: false,
  },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: TEXT_DARK,
    letterSpacing: 2.5,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_MED,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  micro: {
    fontSize: 12,
    color: TEXT_SOFT,
    letterSpacing: 0.3,
    fontWeight: '400',
  },

  // ── Card ──────────────────────────────────────────────────────────
  card: {
    width: '100%',
    backgroundColor: CARD_BG,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    gap: 20,
    marginBottom: 18,
    ...Platform.select({
      web: { boxShadow: '0px 12px 28px rgba(123,158,192,0.18)' } as any,
      default: {
        shadowColor: '#7B9EC0',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 28,
        elevation: 12,
      },
    }),
  },
  cardError: {
    borderColor: 'rgba(255,95,109,0.2)',
    ...Platform.select({
      web: { boxShadow: '0px 12px 28px rgba(255,95,109,0.3)' } as any,
      default: {
        shadowColor: ERROR,
        shadowOpacity: 0.3,
      },
    }),
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_DARK,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  cardDesc: {
    fontSize: 14,
    color: TEXT_MED,
    textAlign: 'center',
    lineHeight: 21,
    letterSpacing: 0.2,
    fontWeight: '400',
    marginTop: -6,
  },

  slotsContainer: {
    width: '100%',
    alignItems: 'center',
  },
  gridContainer: {
    width: '100%',
    alignItems: 'center',
  },

  // ── Action row ────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    flexWrap: 'wrap',
    minHeight: 32,
  },
  chipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#EDF0F4',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  chipDanger: {
    backgroundColor: '#FEF0F1',
    borderColor: 'rgba(255,95,109,0.15)',
  },
  chipText: {
    fontSize: 13,
    color: TEXT_MED,
    fontWeight: '500',
  },
  chipTextDanger: {
    color: ERROR,
  },

  // ── Error hint ────────────────────────────────────────────────────
  errorBadge: {
    backgroundColor: 'rgba(255,95,109,0.09)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,95,109,0.18)',
  },
  errorText: {
    fontSize: 13,
    color: ERROR,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Microcopy ─────────────────────────────────────────────────────
  microcopyBlock: {
    alignItems: 'center',
    gap: 5,
    marginBottom: 22,
  },
  microcopyLine: {
    fontSize: 12.5,
    color: TEXT_SOFT,
    fontWeight: '400',
    letterSpacing: 0.2,
  },

  // ── CTA / Buttons ─────────────────────────────────────────────────
  ctaContainer: {
    width: '100%',
    marginBottom: 16,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  secondaryText: {
    fontSize: 14.5,
    color: TEXT_SOFT,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // ── Username input ────────────────────────────────────────────────
  inputWrapper: {
    width: '100%',
  },
  usernameInput: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EDF0F4',
    paddingHorizontal: 16,
    fontSize: 15,
    color: TEXT_DARK,
    fontWeight: '500',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.06)',
  },

  // ── Loading ───────────────────────────────────────────────────────
  loadingContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 14,
    color: TEXT_MED,
    fontWeight: '500',
  },
});
