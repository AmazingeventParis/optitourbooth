import { useState, useRef, useCallback, useEffect } from 'react';
import { XMarkIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface PhotoLightboxProps {
  photos: Array<{ id: string; src: string; alt?: string }>;
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (photoId: string) => void;
}

export default function PhotoLightbox({ photos, initialIndex, isOpen, onClose, onDelete }: PhotoLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeOffsetRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setScale(1);
  }, [initialIndex, isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  const goNext = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setScale(1);
    }
  }, [currentIndex, photos.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setScale(1);
    }
  }, [currentIndex]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1 || scale > 1) return;

    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    // Only allow horizontal swipe if mostly horizontal
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      swipeOffsetRef.current = deltaX;
      setSwipeOffset(deltaX);
    }
  }, [scale]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const offset = swipeOffsetRef.current;
    const threshold = 80;

    if (offset < -threshold) {
      goNext();
    } else if (offset > threshold) {
      goPrev();
    }

    touchStartRef.current = null;
    swipeOffsetRef.current = 0;
    setSwipeOffset(0);
  }, [goNext, goPrev]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, goNext, goPrev, onClose]);

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 text-white">
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
          <XMarkIcon className="h-6 w-6" />
        </button>
        <span className="text-sm font-medium">
          {currentIndex + 1} / {photos.length}
        </span>
        {onDelete && (
          <button
            onClick={() => onDelete(currentPhoto.id)}
            className="p-2 hover:bg-white/10 rounded-full text-red-400"
          >
            <TrashIcon className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Image */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: scale > 1 ? 'pinch-zoom' : 'pan-y' }}
      >
        <img
          src={currentPhoto.src}
          alt={currentPhoto.alt || ''}
          className="max-w-full max-h-full object-contain transition-transform duration-200"
          style={{
            transform: `translateX(${swipeOffset}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>

      {/* Navigation arrows (desktop) */}
      {currentIndex > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 hidden sm:block"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
      )}
      {currentIndex < photos.length - 1 && (
        <button
          onClick={goNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 hidden sm:block"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
