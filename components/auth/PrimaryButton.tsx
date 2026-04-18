import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

const ENABLED_COLOR = '#4CAF82';
const SHADOW_HEIGHT = 5;

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, value));
}

function darkenHex(hex: string, amount: number) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const num = parseInt(cleaned, 16);
  const r = clampChannel(((num >> 16) & 0xff) * (1 - amount));
  const g = clampChannel(((num >> 8) & 0xff) * (1 - amount));
  const b = clampChannel((num & 0xff) * (1 - amount));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(Math.round(r))}${toHex(Math.round(g))}${toHex(Math.round(b))}`;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  color,
}: PrimaryButtonProps) {
  const th = useAppTheme();
  const translateY = useRef(new Animated.Value(0)).current;
  const enabledScale = useRef(new Animated.Value(disabled ? 0.97 : 1)).current;

  // Spring bounce when enabled
  useEffect(() => {
    if (!disabled) {
      Animated.spring(enabledScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 12,
        bounciness: 16,
      }).start();
    } else {
      Animated.timing(enabledScale, {
        toValue: 0.97,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [disabled]);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    Animated.timing(translateY, {
      toValue: SHADOW_HEIGHT,
      duration: 80,
      useNativeDriver: true,
    }).start();
  }, [disabled, translateY]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      speed: 30,
      bounciness: 10,
    }).start();
  }, [disabled, translateY]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [disabled, onPress]);

  const baseColor = color ?? th.accent ?? ENABLED_COLOR;

  const { bgColor, shadowCol, labelColor, highlightColor } = useMemo(() => {
    if (disabled) {
      return {
        bgColor: th.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
        shadowCol: th.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)',
        labelColor: th.textSoft,
        highlightColor: th.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.35)',
      };
    }

    return {
      bgColor: baseColor,
      shadowCol: darkenHex(baseColor, th.isDark ? 0.35 : 0.25),
      labelColor: '#FFFFFF',
      highlightColor: th.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.45)',
    };
  }, [baseColor, disabled, th.isDark, th.textSoft]);

  return (
    <Animated.View
      style={[
        styles.shadowWrapper,
        {
          backgroundColor: shadowCol,
          transform: [{ scale: enabledScale }],
        },
      ]}
    >
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          disabled={disabled}
          style={[styles.button, { backgroundColor: bgColor, borderTopColor: highlightColor }]}
        >
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadowWrapper: {
    borderRadius: 28,
    // The "bottom" shadow is actually the wrapper peeking below the button
    marginBottom: SHADOW_HEIGHT,
  },
  button: {
    borderRadius: 28,
    paddingVertical: 17,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
    // Top highlight
    borderTopWidth: 2,
    // Slightly offset upward to reveal shadow wrapper
    marginTop: -SHADOW_HEIGHT,
  },
  label: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
