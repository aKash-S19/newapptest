/**
 * app/onboarding.tsx
 *
 * Modern animated onboarding — shown once on first launch.
 * Uses react-native-reanimated for GPU-accelerated slide + fade.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useRef, useState } from 'react';
import {
    Dimensions,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/hooks/use-app-theme';

const { width: SW } = Dimensions.get('window');
const ND = Platform.OS !== 'web';

export const ONBOARDING_KEY = 'privy_onboarded';

// ─── Slides ───────────────────────────────────────────────────────────────────
const SLIDES = [
  {
    icon:     'shield-lock-outline' as const,
    gradient: ['#6C47FF', '#A78BFA'],
    accent:   '#A78BFA',
    title:    'End-to-End Encrypted',
    sub:      'Every message is encrypted on your device. Not even we can read your conversations.',
    badge:    'Military-grade AES-256',
  },
  {
    icon:     'emoticon-outline' as const,
    gradient: ['#F59E0B', '#FCD34D'],
    accent:   '#F59E0B',
    title:    'Emoji-PIN Login',
    sub:      'Forget passwords. Pick 6 emojis as your unique PIN — impossible to guess, easy to remember.',
    badge:    'Zero-knowledge auth',
  },
  {
    icon:     'image-multiple-outline' as const,
    gradient: ['#10B981', '#6EE7B7'],
    accent:   '#10B981',
    title:    'Original Quality Media',
    sub:      'Send photos and files at full resolution. Camera, gallery or documents — all encrypted.',
    badge:    'No compression',
  },
  {
    icon:     'account-multiple-outline' as const,
    gradient: ['#3B82F6', '#93C5FD'],
    accent:   '#3B82F6',
    title:    'Private Friend Network',
    sub:      'Add friends by username. No phone number, no email. Your identity stays in your hands.',
    badge:    'Pseudonymous',
  },
  {
    icon:     'lightning-bolt-outline' as const,
    gradient: ['#EF4444', '#FCA5A5'],
    accent:   '#EF4444',
    title:    'Realtime & Reliable',
    sub:      'Instant delivery, typing indicators, read receipts and push notifications — all live.',
    badge:    'Supabase Realtime',
  },
] as const;

const N = SLIDES.length;

// ─── Card ────────────────────────────────────────────────────────────────────
function SlideCard({
  slide,
  scrollX,
  index,
  isDark,
}: {
  slide: typeof SLIDES[number];
  scrollX: ReturnType<typeof useSharedValue<number>>;
  index: number;
  isDark: boolean;
}) {
  const animStyle = useAnimatedStyle(() => {
    const inputRange = [(index - 1) * SW, index * SW, (index + 1) * SW];
    const opacity = interpolate(scrollX.value, inputRange, [0.35, 1, 0.35]);
    const scale   = interpolate(scrollX.value, inputRange, [0.88, 1, 0.88]);
    const transY  = interpolate(scrollX.value, inputRange, [24, 0, 24]);
    return { opacity, transform: [{ scale }, { translateY: transY }] };
  });

  const [g0, g1] = slide.gradient;

  return (
    <Animated.View style={[{ width: SW, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, animStyle]}>
      {/* Icon card */}
      <View style={[s.iconCard, { shadowColor: g0 }]}>
        {/* Gradient bg via layered Views */}
        <View style={[StyleSheet.absoluteFill, s.iconCardBg, { backgroundColor: g0 }]} />
        <View style={[StyleSheet.absoluteFill, s.iconCardBg, { backgroundColor: g1, opacity: 0.55 }]} />

        {/* Decorative rings */}
        <View style={[s.ring, s.ring1, { borderColor: '#ffffff18' }]} />
        <View style={[s.ring, s.ring2, { borderColor: '#ffffff10' }]} />

        <MaterialCommunityIcons name={slide.icon} size={72} color="#fff" />
      </View>

      {/* Badge pill */}
      <View style={[s.badge, { backgroundColor: slide.accent + '22', borderColor: slide.accent + '55' }]}>
        <View style={[s.badgeDot, { backgroundColor: slide.accent }]} />
        <Text style={[s.badgeText, { color: slide.accent }]}>{slide.badge}</Text>
      </View>

      {/* Title */}
      <Text style={[s.title, { color: isDark ? '#F9FAFB' : '#111827' }]}>
        {slide.title}
      </Text>

      {/* Subtitle */}
      <Text style={[s.sub, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
        {slide.sub}
      </Text>
    </Animated.View>
  );
}

// ─── Dot indicator ────────────────────────────────────────────────────────────
function Dot({ index, scrollX, accent }: {
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  accent: string;
}) {
  const style = useAnimatedStyle(() => {
    const inputRange = [(index - 1) * SW, index * SW, (index + 1) * SW];
    const width   = interpolate(scrollX.value, inputRange, [8, 24, 8]);
    const opacity = interpolate(scrollX.value, inputRange, [0.35, 1, 0.35]);
    return { width, opacity };
  });
  return (
    <Animated.View style={[s.dot, { backgroundColor: accent }, style]} />
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const th     = useAppTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const scrollX   = useSharedValue(0);
  const [page, setPage] = useState(0);
  const btnScale  = useSharedValue(1);

  // current slide accent (for dots + button)
  const accent = SLIDES[page].accent;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    scrollX.value = x;
    setPage(Math.round(x / SW));
  }, [scrollX]);

  const goNext = useCallback(() => {
    if (page < N - 1) {
      scrollRef.current?.scrollTo({ x: (page + 1) * SW, animated: true });
    } else {
      handleGetStarted();
    }
  }, [page]);

  const handleGetStarted = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
    router.replace('/auth');
  }, []);

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const isLast = page === N - 1;

  return (
    <View style={[s.root, { backgroundColor: th.bg }]}>
      {/* Skip */}
      {!isLast && (
        <Pressable
          style={[s.skip, { top: insets.top + 14 }]}
          onPress={handleGetStarted}
        >
          <Text style={[s.skipText, { color: th.textSoft }]}>Skip</Text>
        </Pressable>
      )}

      {/* Slides */}
      <View style={s.slidesWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          onScroll={onScroll}
          scrollEventThrottle={16}
          bounces={false}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {SLIDES.map((slide, i) => (
            <SlideCard
              key={i}
              slide={slide}
              scrollX={scrollX}
              index={i}
              isDark={th.isDark}
            />
          ))}
        </ScrollView>
      </View>

      {/* Bottom section */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 20 }]}>
        {/* Dots */}
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <Dot key={i} index={i} scrollX={scrollX} accent={accent} />
          ))}
        </View>

        {/* CTA Button */}
        <Animated.View style={[s.btnWrap, btnStyle]}>
          <Pressable
            style={[s.btn, { backgroundColor: accent }]}
            onPress={goNext}
            onPressIn={() => { btnScale.value = withSpring(0.95, { damping: 12 }); }}
            onPressOut={() => { btnScale.value = withSpring(1,    { damping: 12 }); }}
          >
            <Text style={s.btnText}>
              {isLast ? 'Get Started' : 'Next'}
            </Text>
            <MaterialCommunityIcons
              name={isLast ? 'arrow-right-circle-outline' : 'arrow-right'}
              size={20}
              color="#fff"
            />
          </Pressable>
        </Animated.View>

        {/* Page counter */}
        <Text style={[s.counter, { color: th.textSoft }]}>
          {page + 1} of {N}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:     { flex: 1 },
  skip:     { position: 'absolute', right: 24, zIndex: 10 },
  skipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  slidesWrap: { flex: 1 },

  // Icon card
  iconCard: {
    width: 160, height: 160,
    borderRadius: 48,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 32,
    shadowOpacity: 0.35, shadowRadius: 32, shadowOffset: { width: 0, height: 12 },
    elevation: 14,
    overflow: 'hidden',
  },
  iconCardBg: { borderRadius: 48 },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 999,
  },
  ring1: { width: 200, height: 200 },
  ring2: { width: 240, height: 240 },

  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 99, borderWidth: 1,
    marginBottom: 20,
  },
  badgeDot:  { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },

  // Text
  title: {
    fontSize: 28, fontFamily: 'Inter_700Bold',
    textAlign: 'center', lineHeight: 34,
    marginBottom: 14,
  },
  sub: {
    fontSize: 15, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 23,
    paddingHorizontal: 8,
  },

  // Bottom
  bottom:  { paddingHorizontal: 32, gap: 18 },
  dots:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot:     { height: 8, borderRadius: 4 },

  btnWrap: {},
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 20,
    shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  btnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },

  counter: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular' },
});
