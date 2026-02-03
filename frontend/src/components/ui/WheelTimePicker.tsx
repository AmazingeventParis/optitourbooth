import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

interface WheelTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 10, 20, 30, 40, 50];

export default function WheelTimePicker({ value, onChange, label, placeholder }: WheelTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial value
  useEffect(() => {
    if (value) {
      const match = value.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        setSelectedHour(parseInt(match[1], 10));
        const min = parseInt(match[2], 10);
        // Round to nearest 10
        setSelectedMinute(Math.round(min / 10) * 10);
      }
    }
  }, [value]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleHourClick = (hour: number) => {
    setSelectedHour(hour);
    if (selectedMinute !== null) {
      const timeStr = `${String(hour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`;
      onChange(timeStr);
    }
  };

  const handleMinuteClick = (minute: number) => {
    setSelectedMinute(minute);
    if (selectedHour !== null) {
      const timeStr = `${String(selectedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      onChange(timeStr);
      setIsOpen(false);
    }
  };

  const displayValue = value || placeholder || '--:--';

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full px-3 py-2 text-left rounded-lg border text-sm',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          value ? 'text-gray-900 border-gray-300' : 'text-gray-400 border-gray-300'
        )}
      >
        {displayValue}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 bg-white rounded-xl shadow-xl border p-4" style={{ width: '280px' }}>
          <div className="text-center mb-3 text-sm font-medium text-gray-700">
            {selectedHour !== null && selectedMinute !== null
              ? `${String(selectedHour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`
              : 'Sélectionnez l\'heure'}
          </div>

          {/* Wheel container */}
          <div className="relative" style={{ width: '248px', height: '248px', margin: '0 auto' }}>
            {/* Outer wheel - Hours */}
            <div className="absolute inset-0">
              {HOURS.map((hour) => {
                const angle = (hour / 24) * 360 - 90;
                const radius = 110;
                const x = Math.cos((angle * Math.PI) / 180) * radius + 124;
                const y = Math.sin((angle * Math.PI) / 180) * radius + 124;

                return (
                  <button
                    key={`hour-${hour}`}
                    type="button"
                    onClick={() => handleHourClick(hour)}
                    className={clsx(
                      'absolute w-8 h-8 -ml-4 -mt-4 rounded-full text-xs font-medium transition-all',
                      'hover:bg-primary-100',
                      selectedHour === hour
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-gray-700'
                    )}
                    style={{ left: `${x}px`, top: `${y}px` }}
                  >
                    {hour}
                  </button>
                );
              })}
            </div>

            {/* Inner wheel - Minutes */}
            <div className="absolute inset-0">
              {MINUTES.map((minute) => {
                const angle = (minute / 60) * 360 - 90;
                const radius = 55;
                const x = Math.cos((angle * Math.PI) / 180) * radius + 124;
                const y = Math.sin((angle * Math.PI) / 180) * radius + 124;

                return (
                  <button
                    key={`minute-${minute}`}
                    type="button"
                    onClick={() => handleMinuteClick(minute)}
                    className={clsx(
                      'absolute w-10 h-10 -ml-5 -mt-5 rounded-full text-sm font-medium transition-all',
                      'hover:bg-orange-100',
                      selectedMinute === minute
                        ? 'bg-orange-500 text-white'
                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                    )}
                    style={{ left: `${x}px`, top: `${y}px` }}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            {/* Center */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-gray-300" />
          </div>

          {/* Legend */}
          <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-primary-500" /> Heures
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-orange-500" /> Minutes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
