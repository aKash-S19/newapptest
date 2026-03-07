import React from 'react';
import { StyleSheet, View } from 'react-native';
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

const COLUMNS = 6;
const BUTTON_SIZE = 44;
const GAP = 8;

interface EmojiGridProps {
  onEmojiPress: (emoji: string) => void;
}

export function EmojiGrid({ onEmojiPress }: EmojiGridProps) {
  const rows: string[][] = [];
  for (let i = 0; i < EMOJIS.length; i += COLUMNS) {
    rows.push(EMOJIS.slice(i, i + COLUMNS));
  }

  return (
    <View style={styles.container}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={styles.row}>
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
    gap: GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
