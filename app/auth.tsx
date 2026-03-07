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
import { useAppTheme } from '@/hooks/use-app-theme';
import { CONTENT_MAX_WIDTH, useLayout } from '@/lib/responsive';

// ????????? Types & constants ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
type Step = 'boot' | 'new-username' | 'new-pin' | 'return-pin';

const MAX_EMOJIS = 6;
const ND = Platform.OS !== 'web';

// ????????? Username validation ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
const USERNAME_BLACKLIST = new Set([
  'admin', 'administrator', 'support', 'help', 'system', 'root', 'mod',
  'moderator', 'staff', 'privy', 'official', 'security', 'null', 'undefined',
  'delete', 'api', 'test', 'bot', 'spam', 'anonymous', 'everyone', 'here',
]);
function validateUsername(u: string): { ok: boolean; reason?: string } {
  if (u.length < 4)  return { ok: false, reason: 'Too short \u2014 min 4 characters' };
  if (u.length > 20) return { ok: false, reason: 'Too long \u2014 max 20 characters' };
  if (!USERNAME_RE.test(u)) return { ok: false, reason: 'Letters, numbers and _ only' };
  if (USERNAME_BLACKLIST.has(u)) return { ok: false, reason: 'That username is reserved' };
  return { ok: true };
}

// ????????? Small inline components ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function ActionRow({
  selected, total, onRemoveLast, onClearAll,
}: { selected: string[]; total: number; onRemoveLast: () => void; onClearAll: () => void }) {
  return (
    <View style={styles.actionRow}>
      {selected.length > 0 && (
        <Pressable onPress={onRemoveLast} style={styles.chipBtn}>
          <Text style={styles.chipText}>{'\u232b'}  Remove last</Text>
        </Pressable>
      )}
      {selected.length === total && (
        <Pressable onPress={onClearAll} style={[styles.chipBtn, styles.chipDanger]}>
          <Text style={[styles.chipText, styles.chipTextDanger]}>{'\u2715'}  Clear all</Text>
        </Pressable>
      )}
    </View>
  );
}

function ErrorBadge({ message }: { message: string }) {
  return (
    <View style={styles.errorBadge}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function StepDots({ current }: { current: number }) {
  return (
    <View style={styles.dotsRow}>
      {[0, 1].map(i => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
      ))}
    </View>
  );
}

// ????????? Main screen ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
export default function AuthScreen() {
  const th = useAppTheme();
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { status, deviceUsername, register, loginWithUsername, checkUsername, login } = useAuth();
  const { isTablet, isSmallPhone } = useLayout();

  // ── Responsive sizing ─────────────────────────────────────────────────────
  const lockSize     = isTablet ? 96  : isSmallPhone ? 62  : 76;
  const lockIconFS   = isTablet ? 44  : isSmallPhone ? 28  : 34;
  const appNameFS    = isTablet ? 42  : isSmallPhone ? 28  : 36;
  const taglineFS    = isTablet ? 18  : isSmallPhone ? 13  : 16;
  const cardMaxWidth = isTablet ? CONTENT_MAX_WIDTH : undefined;
  const scrollHPad   = isTablet ? 32  : 20;

  const [step, setStep] = useState<Step>('boot');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [username,       setUsername]       = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'invalid' | 'ok'>('idle');
  const [usernameReason, setUsernameReason] = useState('');
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);

  const [isLoading,   setIsLoading]   = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasError,    setHasError]    = useState(false);

  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenSlide   = useRef(new Animated.Value(32)).current;
  const brandScale    = useRef(new Animated.Value(0.85)).current;
  const shakeX        = useRef(new Animated.Value(0)).current;
  const cardOpacity   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenOpacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.spring(screenSlide,   { toValue: 0, useNativeDriver: ND, speed: 10, bounciness: 6 }),
      Animated.spring(brandScale,    { toValue: 1, useNativeDriver: ND, speed: 8, bounciness: 14, delay: 200 } as any),
    ]).start();
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/(tabs)');
    } else if (status === 'unauthenticated') {
      setStep(deviceUsername ? 'return-pin' : 'new-username');
    }
  }, [status, deviceUsername]);

  const shake = useCallback(() => {
    setHasError(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -12, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue:  12, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue:  -9, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue:   9, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue:  -5, duration: 55, useNativeDriver: ND }),
      Animated.timing(shakeX, { toValue:   0, duration: 55, useNativeDriver: ND }),
    ]).start();
    setTimeout(() => setHasError(false), 1800);
  }, [shakeX]);

  const goToStep = useCallback((next: Step) => {
    Animated.timing(cardOpacity, { toValue: 0, duration: 180, useNativeDriver: ND }).start(() => {
      setServerError(null);
      setHasError(false);
      setStep(next);
      Animated.timing(cardOpacity, { toValue: 1, duration: 220, useNativeDriver: ND }).start();
    });
  }, [cardOpacity]);

  const handleEmojiPress = useCallback((emoji: string) => {
    setHasError(false);
    setSelectedEmojis(prev => prev.length >= MAX_EMOJIS ? prev : [...prev, emoji]);
  }, []);

  const handleRemoveLast = useCallback(() => {
    setHasError(false);
    setSelectedEmojis(prev => prev.slice(0, -1));
  }, []);

  const handleUsernameNext = useCallback(async () => {
    const trimmed = username.trim().toLowerCase();
    const v = validateUsername(trimmed);
    if (!v.ok) {
      setUsernameStatus('invalid');
      setUsernameReason(v.reason ?? 'Invalid username');
      shake();
      return;
    }

    setServerError(null);
    setIsLoading(true);
    try {
      const res = await checkUsername(trimmed);
      if (isLoggingIn) {
        if (res.available) {
          setUsernameStatus('invalid');
          setUsernameReason('Account not found');
          shake();
          return;
        }
      } else {
        if (!res.available) {
          setUsernameStatus('invalid');
          setUsernameReason(res.reason ?? 'Username already taken');
          shake();
          return;
        }
      }
      setUsernameStatus('ok');
      goToStep('new-pin');
    } catch (err: any) {
      setServerError(err.message ?? 'Failed to verify username');
      shake();
    } finally {
      setIsLoading(false);
    }
  }, [username, isLoggingIn, shake, goToStep, checkUsername]);

  const handleIdentityAction = useCallback(async () => {
    if (selectedEmojis.length < MAX_EMOJIS) { shake(); return; }
    setServerError(null);
    setIsLoading(true);
    try {
      if (isLoggingIn) {
        await loginWithUsername(username.trim().toLowerCase(), selectedEmojis);
      } else {
        await register(username.trim().toLowerCase(), selectedEmojis);
      }
    } catch (err: any) {
      setServerError(err.message ?? 'Something went wrong');
      shake();
    } finally { setIsLoading(false); }
  }, [username, selectedEmojis, isLoggingIn, loginWithUsername, register, shake]);

  const handleLogin = useCallback(async () => {
    if (selectedEmojis.length < MAX_EMOJIS) { shake(); return; }
    setServerError(null);
    setIsLoading(true);
    try {
      await login(selectedEmojis);
    } catch (err: any) {
      setServerError(err.message ?? 'Incorrect emoji key');
      shake();
    } finally { setIsLoading(false); }
  }, [selectedEmojis, login, shake]);

  if (step === 'boot') {
    return (
      <SafeAreaView style={[styles.safe, styles.bootCenter, { backgroundColor: th.bg }]}>
        <View style={[styles.lockCard, { backgroundColor: th.cardBg, width: lockSize, height: lockSize, borderRadius: lockSize / 2 }]}>
          <Text style={[styles.lockIcon, { fontSize: lockIconFS }]}>🔒</Text>
        </View>
        <Text style={[styles.appName, { color: th.textDark, fontSize: appNameFS }]}>Privy</Text>
        <ActivityIndicator size="large" color={th.accent} style={{ marginTop: 24 }} />
      </SafeAreaView>
    );
  }

  const isNewFlow    = step === 'new-username' || step === 'new-pin';
  const newFlowIndex = step === 'new-username' ? 0 : 1;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: th.bg }]}>
      <View style={styles.blobTopRight} />
      <View style={styles.blobBottomLeft} />

      <Animated.View style={[styles.screen, { opacity: screenOpacity, transform: [{ translateY: screenSlide }] }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: scrollHPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.branding, { transform: [{ scale: brandScale }] }]}>
            <View style={[styles.lockCard, { backgroundColor: th.cardBg, width: lockSize, height: lockSize, borderRadius: lockSize / 2 }]}>
              <Text style={[styles.lockIcon, { fontSize: lockIconFS }]}>🔒</Text>
            </View>
            <Text style={[styles.appName, { color: th.textDark, fontSize: appNameFS }]}>Privy</Text>
            <Text style={[styles.tagline, { color: th.textMed, fontSize: taglineFS }]}>Private by Design.</Text>
            <Text style={[styles.micro,   { color: th.textSoft }]}>No phone. No email. No tracking.</Text>
          </Animated.View>

          {isNewFlow && <StepDots current={newFlowIndex} />}

          <Animated.View style={[
            styles.card,
            { backgroundColor: th.cardBg, borderColor: th.isDark ? th.border : 'rgba(255,255,255,0.9)', maxWidth: cardMaxWidth },
            hasError && styles.cardError,
            { opacity: cardOpacity, transform: [{ translateX: shakeX }] },
          ]}>

            {step === 'new-username' && (<>
              <Text style={[styles.cardTitle, { color: th.textDark }]}>{isLoggingIn ? 'Log in to Privy' : 'Choose a Username'}</Text>
              <Text style={[styles.cardDesc,  { color: th.textMed  }]}>
                {isLoggingIn 
                  ? 'Enter your existing username to continue.'
                  : '4\u201320 characters \u00b7 letters, numbers, underscores\nThis is how friends find you on Privy.'}
              </Text>
              <View style={styles.inputWrapper}>
                <Text style={[styles.inputLabel, { color: th.textSoft }]}>Username</Text>
                <TextInput
                  style={[
                    styles.textInput,
                    { backgroundColor: th.inputBg, color: th.textDark, borderColor: th.border },
                    usernameStatus === 'ok'      && styles.textInputGood,
                    usernameStatus === 'invalid' && styles.textInputBad,
                  ]}
                  placeholder="e.g. captain_vijay"
                  placeholderTextColor={th.textSoft}
                  value={username}
                  onChangeText={v => {
                    const cleaned = v.toLowerCase().replace(/[^a-z0-9_]/g, '');
                    setUsername(cleaned);
                    setUsernameStatus('idle');
                    if (cleaned.length >= 4) {
                      const r = validateUsername(cleaned);
                      if (!r.ok) { setUsernameStatus('invalid'); setUsernameReason(r.reason ?? 'Invalid'); }
                      else { setUsernameStatus('ok'); }
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  returnKeyType="next"
                  onSubmitEditing={handleUsernameNext}
                />
                <View style={styles.usernameStatusRow}>
                  {usernameStatus === 'ok'      && <Text style={styles.statusOk}>{'\u2713'}  Looks good!</Text>}
                  {usernameStatus === 'invalid' && <Text style={styles.statusBad}>{'\u2717'}  {usernameReason}</Text>}
                </View>
              </View>
              <View style={[styles.rulesBadge, { backgroundColor: th.inputBg }]}>
                <Text style={[styles.rulesText, { color: th.textSoft }]}>{isLoggingIn ? 'Enter your existing Privy username' : 'No phone number, no email required'}</Text>
              </View>
              {serverError && <ErrorBadge message={serverError} />}
            </>)}

            {step === 'new-pin' && (<>
              <Text style={[styles.cardTitle, { color: th.textDark }]}>{isLoggingIn ? 'Enter Your Emoji Key' : 'Create Your Emoji Key'}</Text>
              <Text style={[styles.cardDesc,  { color: th.textMed  }]}>
                {isLoggingIn 
                  ? 'Enter the 6-emoji password for your account.'
                  : 'Pick 6 emojis in order.\nThis is your password \u2014 remember it!'}
              </Text>
              <EmojiSlots selected={selectedEmojis} total={MAX_EMOJIS} />
              <EmojiGrid onEmojiPress={handleEmojiPress} />
              <ActionRow
                selected={selectedEmojis} total={MAX_EMOJIS}
                onRemoveLast={handleRemoveLast}
                onClearAll={() => setSelectedEmojis([])}
              />
              {serverError && <ErrorBadge message={serverError} />}
            </>)}

            {step === 'return-pin' && (<>
              <Text style={[styles.cardTitle, { color: th.textDark }]}>
                {deviceUsername ? `Welcome back, ${deviceUsername}! 👋` : 'Welcome back! 👋'}
              </Text>
              <Text style={[styles.cardDesc, { color: th.textMed }]}>Enter your 6-emoji key to unlock Privy.</Text>
              <EmojiSlots selected={selectedEmojis} total={MAX_EMOJIS} />
              <EmojiGrid onEmojiPress={handleEmojiPress} />
              <ActionRow
                selected={selectedEmojis} total={MAX_EMOJIS}
                onRemoveLast={handleRemoveLast}
                onClearAll={() => setSelectedEmojis([])}
              />
              {serverError && <ErrorBadge message={serverError} />}
            </>)}

          </Animated.View>

          {(step === 'new-pin' || step === 'return-pin') && (
            <View style={styles.microcopyBlock}>
              <Text style={[styles.microcopyLine, { color: th.textSoft }]}>{'\ud83d\udd10'}  Your key stays on your device.</Text>
              <Text style={[styles.microcopyLine, { color: th.textSoft }]}>{'\u2728'}  Only you control your identity.</Text>
            </View>
          )}

        </ScrollView>
        <View style={[styles.stickyFooter, { backgroundColor: th.bg + 'F2', paddingHorizontal: scrollHPad }]}>
          <View style={cardMaxWidth ? { maxWidth: cardMaxWidth, width: '100%', alignSelf: 'center' } : {}}>
          <View style={styles.ctaContainer}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={th.accent} />
                <Text style={[styles.loadingText, { color: th.textMed }]}>
                  {step === 'new-pin' && isLoggingIn
                    ? 'Logging you in\u2026'
                    : step === 'new-pin'
                    ? 'Creating your identity\u2026'
                    : step === 'return-pin'
                    ? 'Verifying your key\u2026'
                    : 'Please wait\u2026'}
                </Text>
              </View>
            ) : (<>
              {step === 'new-username' && (
                <PrimaryButton label={'Next \u2192'} onPress={handleUsernameNext} disabled={username.trim().length < 4} />
              )}
              {step === 'new-pin' && (
                <PrimaryButton label={isLoggingIn ? "Log In" : "Create My Identity"} onPress={handleIdentityAction} disabled={selectedEmojis.length < MAX_EMOJIS} />
              )}
              {step === 'return-pin' && (
                <PrimaryButton label="Unlock Privy" onPress={handleLogin} disabled={selectedEmojis.length < MAX_EMOJIS} />
              )}
            </>)}
          </View>{/* ctaContainer */}

          {step === 'new-pin' && (
            <Pressable onPress={() => goToStep('new-username')} style={styles.secondaryBtn}>
              <Text style={[styles.secondaryText, { color: th.textSoft }]}>{'←'} Change username</Text>
            </Pressable>
          )}

          {step === 'new-username' && !isLoading && (
            <Pressable onPress={() => {
              setIsLoggingIn(!isLoggingIn);
              setUsernameStatus('idle');
              setUsernameReason('');
            }} style={styles.secondaryBtn}>
              <Text style={[styles.secondaryText, { color: th.textSoft }]}>
                {isLoggingIn ? 'Need an account? Create one →' : 'Already have an account? Log in →'}
              </Text>
            </Pressable>
          )}
          </View>{/* tablet wrapper */}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const BG        = '#F4F6F8';
const CARD_BG   = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_MED  = '#5A7182';
const TEXT_SOFT = '#8FA3B1';
const ACCENT    = '#4CAF82';
const ERROR     = '#FF5F6D';

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  bootCenter: { justifyContent: 'center', alignItems: 'center' },
  blobTopRight: {
    position: 'absolute', top: -80, right: -80, width: 260, height: 260,
    borderRadius: 130, backgroundColor: 'rgba(76,175,130,0.07)', pointerEvents: 'none',
  },
  blobBottomLeft: {
    position: 'absolute', bottom: -100, left: -60, width: 280, height: 280,
    borderRadius: 140, backgroundColor: 'rgba(92,155,214,0.07)', pointerEvents: 'none',
  },
  screen: { flex: 1 },
  scrollContent: {
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 60,
    alignItems: 'center',
  },
  branding: { alignItems: 'center', marginBottom: 20 },
  lockCard: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)',
    marginBottom: 14,
    ...Platform.select({
      web:     { boxShadow: '0px 8px 16px rgba(123,158,192,0.28)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 10 },
    }),
  },
  lockIcon: { fontSize: 34, includeFontPadding: false },
  appName:  { fontSize: 36, fontFamily: 'Inter_700Bold', letterSpacing: 2.5, marginBottom: 4 },
  tagline:  { fontSize: 16, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  micro:    { fontSize: 12, fontFamily: 'Inter_400Regular', letterSpacing: 0.3 },
  dotsRow:   { flexDirection: 'row', gap: 6, marginBottom: 14 },
  dot:       { width: 8,  height: 8, borderRadius: 4, backgroundColor: '#D0DAE4' },
  dotActive: { width: 22, height: 8, borderRadius: 4, backgroundColor: ACCENT },
  card: {
    width: '100%', borderRadius: 28,
    padding: 24, borderWidth: 1.5,
    alignItems: 'center', gap: 18, marginBottom: 18,
    ...Platform.select({
      web:     { boxShadow: '0px 12px 28px rgba(123,158,192,0.18)' } as any,
      default: { shadowColor: '#7B9EC0', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 28, elevation: 12 },
    }),
  },
  cardError: {
    borderColor: 'rgba(255,95,109,0.2)',
    ...Platform.select({
      web:     { boxShadow: '0px 12px 28px rgba(255,95,109,0.3)' } as any,
      default: { shadowColor: ERROR, shadowOpacity: 0.3 },
    }),
  },
  cardTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center', letterSpacing: 0.3 },
  cardDesc:  { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21, letterSpacing: 0.2, marginTop: -4 },
  actionRow:      { flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap', minHeight: 32 },
  chipBtn:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#EDF0F4', borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)' },
  chipDanger:     { backgroundColor: '#FEF0F1', borderColor: 'rgba(255,95,109,0.15)' },
  chipText:       { fontSize: 13, color: TEXT_MED, fontFamily: 'Inter_500Medium' },
  chipTextDanger: { color: ERROR },
  errorBadge: { backgroundColor: 'rgba(255,95,109,0.09)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,95,109,0.18)', width: '100%' },
  errorText:  { fontSize: 13, color: ERROR, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  inputWrapper: { width: '100%', gap: 6 },
  inputLabel:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
  textInput: {
    width: '100%', height: 50, borderRadius: 14,
    paddingHorizontal: 16, fontSize: 15, fontFamily: 'Inter_400Regular',
    borderWidth: 1.5,
  },
  textInputGood: { borderColor: 'rgba(76,175,130,0.5)', backgroundColor: 'rgba(76,175,130,0.05)' },
  textInputBad:  { borderColor: 'rgba(255,95,109,0.4)', backgroundColor: 'rgba(255,95,109,0.04)' },
  usernameStatusRow: { flexDirection: 'row', alignItems: 'center', minHeight: 18 },
  statusOk:  { fontSize: 13, color: ACCENT, fontFamily: 'Inter_600SemiBold' },
  statusBad: { fontSize: 13, color: ERROR,  fontFamily: 'Inter_600SemiBold' },
  rulesBadge: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  rulesText:  { fontSize: 12, textAlign: 'center', fontFamily: 'Inter_400Regular' },
  microcopyBlock: { alignItems: 'center', gap: 5, marginBottom: 22 },
  microcopyLine:  { fontSize: 12.5, fontFamily: 'Inter_400Regular', letterSpacing: 0.2 },
  stickyFooter: {
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 24 : 10,
  },
  ctaContainer:    { width: '100%', marginBottom: 16 },
  loadingContainer:{ alignItems: 'center', gap: 12, paddingVertical: 8 },
  loadingText:     { fontSize: 14, fontFamily: 'Inter_500Medium' },
  secondaryBtn:    { paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'center' },
  secondaryText:   { fontSize: 14.5, fontFamily: 'Inter_500Medium', textAlign: 'center', letterSpacing: 0.2 },
});
