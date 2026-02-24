import { useRef, useCallback } from 'react';

interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  maxAngle?: number; // Max deviation from horizontal in degrees
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  threshold = 80,
  maxAngle = 30,
}: UseSwipeGestureOptions) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!startRef.current) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - startRef.current.x;
    const deltaY = endY - startRef.current.y;

    startRef.current = null;

    // Check minimum distance
    if (Math.abs(deltaX) < threshold) return;

    // Check angle (must be mostly horizontal)
    const angle = Math.abs(Math.atan2(deltaY, deltaX) * (180 / Math.PI));
    const isHorizontal = angle < maxAngle || angle > (180 - maxAngle);
    if (!isHorizontal) return;

    if (deltaX < 0 && onSwipeLeft) {
      onSwipeLeft();
    } else if (deltaX > 0 && onSwipeRight) {
      onSwipeRight();
    }
  }, [onSwipeLeft, onSwipeRight, threshold, maxAngle]);

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
  };
}
