import * as Haptics from 'expo-haptics';
import React, { useCallback, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

interface EmojiButtonProps {
  emoji: string;
  onPress: (emoji: string) => void;
  size?: number;
}

export function EmojiButton({ emoji, onPress, size = 48 }: EmojiButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const handlePressIn = useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 0.91,
        useNativeDriver: true,
        speed: 50,
        bounciness: 2,
      }),
      Animated.timing(translateY, {
        toValue: 3,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, translateY]);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 30,
        bounciness: 14,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 30,
        bounciness: 14,
      }),
    ]).start();
  }, [scale, translateY]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(emoji);
  }, [emoji, onPress]);

  const tileSize = size;

  return (
    <Animated.View
      style={[
        styles.shadowBase,
        {
          width: tileSize,
          height: tileSize,
          borderRadius: 18,
          transform: [{ scale }, { translateY }],
        },
      ]}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={[styles.tile, { width: tileSize, height: tileSize, borderRadius: 18 }]}
      >
        <Text style={[styles.emoji, { fontSize: tileSize * 0.46 }]}>{emoji}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadowBase: {
    backgroundColor: '#FFFFFF',
    // Clay lift shadow
    shadowColor: '#B0BEC5',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 6,
  },
  tile: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    // Inner highlight (top-left) via border
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  emoji: {
    textAlign: 'center',
    includeFontPadding: false,
  },
});
