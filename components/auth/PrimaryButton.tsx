import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

const ENABLED_COLOR = '#4CAF82';
const SHADOW_COLOR = '#2E7D55';
const DISABLED_COLOR = '#C8D8CC';
const DISABLED_SHADOW = '#B0C4B8';
const SHADOW_HEIGHT = 5;

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  color,
}: PrimaryButtonProps) {
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

  const bgColor = disabled ? DISABLED_COLOR : (color ?? ENABLED_COLOR);
  const shadowCol = disabled ? DISABLED_SHADOW : SHADOW_COLOR;

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
          style={[styles.button, { backgroundColor: bgColor }]}
        >
          <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
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
    borderTopColor: 'rgba(255,255,255,0.45)',
    // Slightly offset upward to reveal shadow wrapper
    marginTop: -SHADOW_HEIGHT,
  },
  label: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  labelDisabled: {
    color: 'rgba(255,255,255,0.65)',
  },
});
