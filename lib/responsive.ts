/**
 * lib/responsive.ts
 *
 * Reactive layout helpers for phones, large phones, and tablets.
 * Uses useWindowDimensions so values update on rotation / fold / split-screen.
 */
import { useWindowDimensions } from 'react-native';

// ─── Constants ────────────────────────────────────────────────────────────────
/** Max card / content width on tablets for comfortable reading */
export const CONTENT_MAX_WIDTH = 560;

/** Horizontal padding of the auth screen ScrollView */
const AUTH_SCROLL_H_PAD = 20;
/** Horizontal padding inside the auth card */
const AUTH_CARD_H_PAD = 24;

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLayout() {
  const { width, height } = useWindowDimensions();

  /** Tablet: iPad, large Android tablets, foldables in landscape */
  const isTablet = width >= 768;
  /** Small phones: Galaxy A-series, Moto E, older iPhones (SE 1st gen) */
  const isSmallPhone = width < 360;

  /**
   * Pixel width available to inline widgets (emoji grid / slots) inside the
   * full-width auth card, after subtracting screen padding + card padding.
   *
   *   authCardInner = min(cardMaxWidth, screenWidth) – 2×scrollPad – 2×cardPad
   */
  const authCardInner =
    Math.min(isTablet ? CONTENT_MAX_WIDTH : width, width)
    - 2 * AUTH_SCROLL_H_PAD
    - 2 * AUTH_CARD_H_PAD;

  return { width, height, isTablet, isSmallPhone, authCardInner };
}
