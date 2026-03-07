import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';

interface EmojiSlotsProps {
  selected: string[];
  total?: number;
  /** Override bubble size. Defaults to 64 for ≤4 slots, 50 for 6 slots. */
  size?: number;
}

function SlotBubble({ emoji, index, bubbleSize }: { emoji: string | null; index: number; bubbleSize: number }) {
  const scale = useRef(new Animated.Value(emoji ? 0 : 1)).current;
  const opacity = useRef(new Animated.Value(emoji ? 0 : 1)).current;

  useEffect(() => {
    if (emoji) {
      // Bounce in
      scale.setValue(0.4);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 18,
          bounciness: 20,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(1);
      opacity.setValue(1);
    }
  }, [emoji]);

  const filled = !!emoji;

  return (
    <Animated.View
      style={[
        styles.bubble,
        filled ? styles.bubbleFilled : styles.bubbleEmpty,
        { width: bubbleSize, height: bubbleSize, borderRadius: bubbleSize / 2, transform: [{ scale }] },
      ]}
    >
      {filled ? (
        <Animated.Text style={[styles.emojiText, { fontSize: bubbleSize * 0.48, opacity }]}>{emoji}</Animated.Text>
      ) : (
        <View style={styles.emptyDot} />
      )}
    </Animated.View>
  );
}

export function EmojiSlots({ selected, total = 4, size }: EmojiSlotsProps) {
  const bubbleSize = size ?? (total <= 4 ? 64 : 50);
  const slots = Array.from({ length: total }, (_, i) => selected[i] ?? null);

  return (
    <View style={styles.container}>
      <View style={[styles.row, { gap: bubbleSize <= 50 ? 10 : 14 }]}>
        {slots.map((emoji, i) => (
          <SlotBubble key={i} emoji={emoji} index={i} bubbleSize={bubbleSize} />
        ))}
      </View>
      <Text style={styles.progress}>
        {selected.length === 0
          ? 'Tap emojis to build your key'
          : selected.length === total
          ? '✓ Key complete!'
          : `${selected.length} of ${total} selected`}
      </Text>
    </View>
  );
}

const BUBBLE_SIZE = 64;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleEmpty: {
    backgroundColor: '#EDF0F4',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    ...Platform.select({
      web: { boxShadow: '2px 2px 6px rgba(176,190,197,0.4)' } as any,
      default: {
        shadowColor: '#B0BEC5',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
        elevation: 2,
      },
    }),
  },
  bubbleFilled: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.95)',
    ...Platform.select({
      web: { boxShadow: '0px 5px 10px rgba(92,155,214,0.35)' } as any,
      default: {
        shadowColor: '#5C9BD6',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 7,
      },
    }),
  },
  emptyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E0',
  },
  emojiText: {
    fontSize: 30,
    textAlign: 'center',
    includeFontPadding: false,
  },
  progress: {
    fontSize: 13,
    color: '#8A9BAB',
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
