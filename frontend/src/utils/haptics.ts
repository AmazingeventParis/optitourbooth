/**
 * Haptic feedback helpers using the Vibration API
 * Gracefully degrades on unsupported devices
 */

function vibrate(pattern: number | number[]): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail if vibration not available
    }
  }
}

export const haptics = {
  /** Light tap feedback (10ms) */
  light: () => vibrate(10),

  /** Medium tap feedback (25ms) */
  medium: () => vibrate(25),

  /** Heavy tap feedback (50ms) */
  heavy: () => vibrate(50),

  /** Success pattern: short-pause-short */
  success: () => vibrate([30, 50, 30]),

  /** Error pattern: long vibration */
  error: () => vibrate([100, 30, 100]),
};
