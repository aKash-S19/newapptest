import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useLayout } from '@/lib/responsive';
import { EmojiButton } from './EmojiButton';

// 60 unique emojis — keyspace: 60⁶ = 46,656,000,000 combinations
const EMOJIS: string[] = [
  '🌟', '❤️', '🎵', '🌈', '🦋', '🌸',
  '🔥', '💎', '🌙', '⭐', '🎯', '🍀',
  '🦄', '🌺', '💫', '🎪', '🐬', '🌊',
  '🎭', '🌻', '🍇', '🦊', '🐧', '🌴',
  '🎨', '🏆', '🎲', '🌿', '🍁', '🦅',
  '🎸', '🌍', '💜', '🐉', '🎋', '🌠',
  '🍕', '🎃', '🦁', '🐯', '🌵', '🏔️',
  '🐝', '🍓', '🦚', '🌷', '🎈', '🎠',
  '🐙', '🦩', '🌶️', '🏄', '🎻', '🎡',
  '🐋', '🍄', '🌏', '🦜', '🐺', '🦸',
];

// Gap between buttons — constant on all screen sizes
const GAP = 8;

interface EmojiGridProps {
  onEmojiPress: (emoji: string) => void;
}

export function EmojiGrid({ onEmojiPress }: EmojiGridProps) {
  const { isTablet, isSmallPhone, authCardInner } = useLayout();

  // Tablet: wider card → more columns; small phone: fewer columns
  const COLUMNS = isTablet ? 8 : isSmallPhone ? 5 : 6;

  // Fill the available card width proportionally; clamp between 32 and 72 px
  const BUTTON_SIZE = Math.min(
    72,
    Math.max(32, Math.floor((authCardInner - (COLUMNS - 1) * GAP) / COLUMNS)),
  );

  const rows: string[][] = [];
  for (let i = 0; i < EMOJIS.length; i += COLUMNS) {
    rows.push(EMOJIS.slice(i, i + COLUMNS));
  }

  return (
    <View style={styles.container}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={[styles.row, { gap: GAP }]}>
          {row.map((emoji) => (
            <EmojiButton
              key={emoji}
              emoji={emoji}
              onPress={onEmojiPress}
              size={BUTTON_SIZE}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: GAP,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
