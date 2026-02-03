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
  const [step, setStep] = useState<'hour' | 'minute'>('hour');
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial value
  useEffect(() => {
    if (value) {
      const match = value.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        setSelectedHour(parseInt(match[1], 10));
        const min = parseInt(match[2], 10);
        setSelectedMinute(Math.round(min / 10) * 10);
      }
    } else {
      setSelectedHour(null);
      setSelectedMinute(null);
    }
  }, [value]);

  // Reset step when opening
  useEffect(() => {
    if (isOpen) {
      setStep(selectedHour !== null ? 'minute' : 'hour');
    }
  }, [isOpen, selectedHour]);

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
    setStep('minute');
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
    } else {
      setStep('hour');
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
        <div className="absolute z-50 mt-1 bg-white rounded-xl shadow-xl border p-4 left-0" style={{ width: '280px' }}>
          {/* Header with current selection */}
          <div className="text-center mb-3">
            <div className="text-2xl font-bold text-gray-800">
              <button
                type="button"
                onClick={() => setStep('hour')}
                className={clsx(
                  'px-2 py-1 rounded transition-colors',
                  step === 'hour' ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'
                )}
              >
                {selectedHour !== null ? String(selectedHour).padStart(2, '0') : '--'}
              </button>
              <span className="text-gray-400">:</span>
              <button
                type="button"
                onClick={() => setStep('minute')}
                className={clsx(
                  'px-2 py-1 rounded transition-colors',
                  step === 'minute' ? 'bg-orange-100 text-orange-700' : 'hover:bg-gray-100'
                )}
              >
                {selectedMinute !== null ? String(selectedMinute).padStart(2, '0') : '--'}
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {step === 'hour' ? 'Sélectionnez l\'heure' : 'Sélectionnez les minutes'}
            </div>
          </div>

          {/* Hours grid */}
          {step === 'hour' && (
            <div className="grid grid-cols-6 gap-1">
              {HOURS.map((hour) => (
                <button
                  key={`hour-${hour}`}
                  type="button"
                  onClick={() => handleHourClick(hour)}
                  className={clsx(
                    'py-2 rounded-lg text-sm font-medium transition-all',
                    selectedHour === hour
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-50 text-gray-700 hover:bg-primary-100'
                  )}
                >
                  {hour}
                </button>
              ))}
            </div>
          )}

          {/* Minutes grid */}
          {step === 'minute' && (
            <div className="grid grid-cols-3 gap-2">
              {MINUTES.map((minute) => (
                <button
                  key={`minute-${minute}`}
                  type="button"
                  onClick={() => handleMinuteClick(minute)}
                  className={clsx(
                    'py-3 rounded-lg text-lg font-medium transition-all',
                    selectedMinute === minute
                      ? 'bg-orange-500 text-white'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200'
                  )}
                >
                  {String(minute).padStart(2, '0')}
                </button>
              ))}
            </div>
          )}

          {/* Legend */}
          <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
            <button
              type="button"
              onClick={() => setStep('hour')}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded',
                step === 'hour' && 'bg-gray-100'
              )}
            >
              <span className="w-3 h-3 rounded-full bg-primary-500" /> Heures
            </button>
            <button
              type="button"
              onClick={() => setStep('minute')}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded',
                step === 'minute' && 'bg-gray-100'
              )}
            >
              <span className="w-3 h-3 rounded-full bg-orange-500" /> Minutes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
