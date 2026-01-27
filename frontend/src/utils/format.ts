/**
 * Formate une heure au format français "09h10"
 * Accepte: "08:00", "08:00:00", "1970-01-01T08:00:00.000Z", Date
 */
export function formatTime(time: string | Date | null | undefined): string {
  if (!time) return '';

  let hours: number;
  let minutes: number;

  if (time instanceof Date) {
    hours = time.getHours();
    minutes = time.getMinutes();
  } else if (typeof time === 'string') {
    // Format ISO: "1970-01-01T08:00:00.000Z" ou "2026-01-26T08:00:00.000Z"
    if (time.includes('T')) {
      const date = new Date(time);
      hours = date.getUTCHours();
      minutes = date.getUTCMinutes();
    }
    // Format "08:00:00" ou "08:00"
    else if (time.includes(':')) {
      const parts = time.split(':');
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    } else {
      return time; // Retourner tel quel si format inconnu
    }
  } else {
    return '';
  }

  if (isNaN(hours) || isNaN(minutes)) return '';

  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  return `${h}h${m}`;
}

/**
 * Formate un créneau horaire "09h10 - 12h30"
 */
export function formatTimeRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): string {
  const startFormatted = formatTime(start);
  const endFormatted = formatTime(end);

  if (startFormatted && endFormatted) {
    return `${startFormatted} - ${endFormatted}`;
  }
  if (startFormatted) {
    return `à partir de ${startFormatted}`;
  }
  if (endFormatted) {
    return `jusqu'à ${endFormatted}`;
  }
  return '';
}

/**
 * Convertit "09h10" en "09:10" pour les inputs HTML time
 */
export function parseTimeToInput(time: string | null | undefined): string {
  if (!time) return '';

  // Si déjà au format HH:MM
  if (/^\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  // Format "09h10"
  const match = time.match(/^(\d{2})h(\d{2})$/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }

  // Format ISO
  if (time.includes('T')) {
    const date = new Date(time);
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  return time;
}
