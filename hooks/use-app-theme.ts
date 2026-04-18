/**
 * hooks/use-app-theme.ts
 *
 * Single source of truth for all color tokens.
 * Reads darkMode + accentColor from SettingsContext so every screen
 * automatically reacts to the user's theme preference.
 */

import { useSettings } from '@/contexts/SettingsContext';

export const FONT_SIZES: Record<string, number> = { sm: 13, md: 15, lg: 17, xl: 19 };

export interface AppTheme {
  bg:       string;
  cardBg:   string;
  textDark: string;
  textMed:  string;
  textSoft: string;
  accent:   string;
  error:    string;
  border:   string;
  divider:  string;
  inputBg:  string;
  tabBg:    string;
  isDark:   boolean;
  fontSize: number;
}

export function useAppTheme(): AppTheme {
  const { settings } = useSettings();
  const dk = settings.darkMode;

  return {
    bg:       dk ? '#0B0D10' : '#F4F6F8',
    cardBg:   dk ? '#14171C' : '#FFFFFF',
    textDark: dk ? '#F4F6F8' : '#1A2332',
    textMed:  dk ? '#B8C0CC' : '#5A7182',
    textSoft: dk ? '#8892A0' : '#8FA3B1',
    accent:   settings.accentColor,
    error:    '#FF5F6D',
    border:   dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    divider:  dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    inputBg:  dk ? '#1B1F26' : '#EDF0F4',
    tabBg:    dk ? '#14171C' : '#FFFFFF',
    isDark:   dk,
    fontSize: FONT_SIZES[settings.fontSize] ?? 15,
  };
}
