/**
 * Utilitaires pour garantir que toutes les dates sont en UTC
 * CRITIQUE pour éviter les bugs de timezone
 */

/**
 * Convertit une date string (YYYY-MM-DD) en Date UTC à minuit
 * Force TOUJOURS UTC pour éviter les problèmes de timezone
 *
 * @param dateStr - Date au format "YYYY-MM-DD" (ex: "2026-02-16")
 * @returns Date UTC à minuit (ex: 2026-02-16T00:00:00.000Z)
 *
 * @example
 * ensureDateUTC("2026-02-16") // => 2026-02-16T00:00:00.000Z
 */
export function ensureDateUTC(dateStr: string): Date {
  // Ajouter T00:00:00.000Z pour forcer UTC
  if (!dateStr.includes('T')) {
    return new Date(dateStr + 'T00:00:00.000Z');
  }
  // Si déjà un ISO string complet, s'assurer qu'il se termine par Z
  if (!dateStr.endsWith('Z')) {
    return new Date(dateStr + 'Z');
  }
  return new Date(dateStr);
}

/**
 * Convertit une heure (HH:MM) en Date UTC basée sur une date de référence
 * Force TOUJOURS UTC pour éviter les problèmes de timezone
 *
 * @param timeStr - Heure au format "HH:MM" (ex: "14:30")
 * @param referenceDate - Date de référence (doit être en UTC)
 * @returns Date UTC avec l'heure spécifiée ou undefined si timeStr invalide
 *
 * @example
 * const date = new Date("2026-02-16T00:00:00.000Z");
 * timeToUTCDateTime("14:30", date) // => 2026-02-16T14:30:00.000Z
 */
export function timeToUTCDateTime(timeStr: string | undefined, referenceDate: Date): Date | undefined {
  if (!timeStr) return undefined;

  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || !match[1] || !match[2]) return undefined;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Valider les valeurs
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined;
  }

  // Créer une nouvelle date basée sur referenceDate
  const result = new Date(referenceDate);
  // CRITIQUE: Utiliser setUTCHours au lieu de setHours
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Parse une date string et retourne une date UTC à minuit
 * Alias pour ensureDateUTC pour compatibilité
 */
export function parseUTCDate(dateStr: string): Date {
  return ensureDateUTC(dateStr);
}

/**
 * Formatte une date en string YYYY-MM-DD (UTC)
 *
 * @param date - Date à formater
 * @returns String au format "YYYY-MM-DD"
 */
export function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Vérifie si une date est à minuit UTC
 * Utile pour valider les dates de tournées
 */
export function isUTCMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}
