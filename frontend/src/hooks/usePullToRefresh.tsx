import { useEffect, useRef, useState, useCallback } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80 }: UsePullToRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Only activate when scrolled to top
    const scrollTop = containerRef.current?.scrollTop ?? window.scrollY;
    if (scrollTop > 0 || isRefreshing) return;

    startYRef.current = e.touches[0].clientY;
    isPullingRef.current = true;
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPullingRef.current || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    if (diff > 0) {
      // Apply resistance: diminishing returns after threshold
      const distance = diff > threshold ? threshold + (diff - threshold) * 0.3 : diff;
      setPullDistance(distance);
    }
  }, [isRefreshing, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPullingRef.current) return;
    isPullingRef.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold); // Hold at threshold during refresh
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  useEffect(() => {
    const container = containerRef.current || document;

    container.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
    container.addEventListener('touchmove', handleTouchMove as EventListener, { passive: true });
    container.addEventListener('touchend', handleTouchEnd as EventListener);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart as EventListener);
      container.removeEventListener('touchmove', handleTouchMove as EventListener);
      container.removeEventListener('touchend', handleTouchEnd as EventListener);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / threshold, 1);

  const PullIndicator = pullDistance > 10 || isRefreshing ? (
    <div
      className="flex items-center justify-center overflow-hidden transition-all"
      style={{ height: pullDistance > 10 || isRefreshing ? `${Math.min(pullDistance, threshold)}px` : 0 }}
    >
      <div
        className={`w-8 h-8 border-3 border-gray-300 border-t-primary-600 rounded-full ${isRefreshing ? 'animate-spin' : ''}`}
        style={{
          transform: `rotate(${progress * 360}deg)`,
          opacity: progress,
          borderWidth: '3px',
        }}
      />
    </div>
  ) : null;

  return {
    containerRef,
    isRefreshing,
    pullDistance,
    PullIndicator,
  };
}
