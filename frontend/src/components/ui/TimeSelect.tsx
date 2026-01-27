import { useMemo } from 'react';
import { clsx } from 'clsx';

interface TimeSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

// Options des heures (00-23)
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

// Options des minutes (quarts d'heure uniquement)
const MINUTES = ['00', '15', '30', '45'];

/**
 * Sélecteur d'heure avec deux dropdowns séparés : heures (00-23) et minutes (00, 15, 30, 45)
 * Format valeur: "09:15"
 */
export default function TimeSelect({
  label,
  value,
  onChange,
  placeholder = '--',
  error,
  required,
  disabled,
  className,
}: TimeSelectProps) {
  // Extraire heures et minutes de la valeur
  const { hours, minutes } = useMemo(() => {
    if (!value) return { hours: '', minutes: '' };

    let h = '';
    let m = '';

    // Si format ISO (1970-01-01T08:00:00.000Z)
    if (value.includes('T')) {
      const date = new Date(value);
      h = String(date.getUTCHours()).padStart(2, '0');
      m = String(date.getUTCMinutes()).padStart(2, '0');
    }
    // Si format HH:MM ou HH:MM:SS
    else if (value.includes(':')) {
      const parts = value.split(':');
      h = parts[0].padStart(2, '0');
      m = parts[1]?.padStart(2, '0') || '00';
    }

    // Arrondir les minutes au quart d'heure le plus proche
    const minNum = parseInt(m, 10);
    if (!isNaN(minNum)) {
      const rounded = Math.round(minNum / 15) * 15;
      m = String(rounded === 60 ? 0 : rounded).padStart(2, '0');
    }

    return { hours: h, minutes: m };
  }, [value]);

  const handleHoursChange = (newHours: string) => {
    const newMinutes = minutes || '00';
    onChange(newHours ? `${newHours}:${newMinutes}` : '');
  };

  const handleMinutesChange = (newMinutes: string) => {
    const newHours = hours || '00';
    onChange(newHours ? `${newHours}:${newMinutes}` : '');
  };

  const selectClass = clsx(
    'rounded-lg border bg-white px-2 py-2 text-sm',
    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
    error
      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
      : 'border-gray-300',
    disabled && 'bg-gray-100 cursor-not-allowed text-gray-500'
  );

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="flex items-center gap-1">
        {/* Sélecteur d'heures */}
        <select
          value={hours}
          onChange={(e) => handleHoursChange(e.target.value)}
          disabled={disabled}
          className={clsx(selectClass, 'w-16')}
        >
          <option value="">{placeholder}</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>

        <span className="text-gray-500 font-medium">h</span>

        {/* Sélecteur de minutes */}
        <select
          value={minutes}
          onChange={(e) => handleMinutesChange(e.target.value)}
          disabled={disabled}
          className={clsx(selectClass, 'w-16')}
        >
          <option value="">{placeholder}</option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
