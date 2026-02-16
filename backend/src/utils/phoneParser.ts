/**
 * Utilitaire pour parser intelligemment des numéros de téléphone
 * Détecte plusieurs numéros séparés par différents délimiteurs
 */

/**
 * Parse une chaîne contenant un ou plusieurs numéros de téléphone
 * Gère les indicatifs internationaux (+33, 0033, etc.)
 * Accepte différents séparateurs : espace, virgule, slash, underscore, etc.
 *
 * Stratégie : détecte les numéros valides avec regex au lieu de splitter par séparateurs
 *
 * @param input - Chaîne contenant un ou plusieurs numéros de téléphone
 * @returns Tableau de numéros normalisés, ou undefined si aucun numéro trouvé
 *
 * @example
 * parsePhoneNumbers("0612345678") // ["0612345678"]
 * parsePhoneNumbers("06 12 34 56 78, 07 98 76 54 32") // ["0612345678", "0798765432"]
 * parsePhoneNumbers("+33612345678 / 0798765432") // ["+33612345678", "0798765432"]
 * parsePhoneNumbers("06.12.34.56.78 / 07.98.76.54.32") // ["0612345678", "0798765432"]
 */
export function parsePhoneNumbers(input: string | number | undefined): string[] | undefined {
  if (!input) return undefined;

  let str = String(input).trim();
  if (!str) return undefined;

  const phones: string[] = [];

  // Pattern pour détecter un numéro de téléphone :
  // - Commence par + ou 0 ou un chiffre
  // - Peut contenir des chiffres, espaces, points, tirets
  // - Au moins 8 chiffres au total
  // Séparateurs entre numéros : , ; / \ | _ et retours à la ligne

  // Remplacer les séparateurs clairs par un délimiteur unique
  const separators = [',', ';', '/', '\\', '|', '_', '\n', '\t'];
  for (const sep of separators) {
    str = str.split(sep).join('|||');
  }

  // Maintenant splitter par le délimiteur
  const segments = str.split('|||').map(s => s.trim()).filter(s => s.length > 0);

  for (const segment of segments) {
    // Essayer de parser le segment comme un numéro
    const normalized = normalizePhone(segment);
    if (normalized) {
      phones.push(normalized);
    }
  }

  return phones.length > 0 ? phones : undefined;
}

/**
 * Normalise un seul numéro de téléphone
 * - Garde le + pour les indicatifs internationaux
 * - Supprime les espaces, points, tirets à l'intérieur du numéro
 * - Ajoute le 0 si le numéro fait 9 chiffres
 *
 * @param phone - Un seul numéro de téléphone
 * @returns Numéro normalisé ou undefined si invalide
 */
function normalizePhone(phone: string): string | undefined {
  if (!phone) return undefined;

  let phoneStr = phone.trim();

  // Garder le + au début si présent
  const hasPlus = phoneStr.startsWith('+');

  // Supprimer tous les caractères non numériques (sauf le + au début)
  if (hasPlus) {
    phoneStr = '+' + phoneStr.slice(1).replace(/[^\d]/g, '');
  } else {
    phoneStr = phoneStr.replace(/[^\d]/g, '');
  }

  // Si le numéro est vide après nettoyage, invalide
  if (!phoneStr || phoneStr === '+') return undefined;

  // Si le numéro commence par un chiffre et fait 9 chiffres, ajouter le 0
  if (!hasPlus && /^\d{9}$/.test(phoneStr)) {
    phoneStr = '0' + phoneStr;
  }

  // Validation basique : au moins 8 chiffres
  const digitsOnly = phoneStr.replace(/[^\d]/g, '');
  if (digitsOnly.length < 8) return undefined;

  return phoneStr;
}

/**
 * Convertit un tableau de numéros en chaîne formatée pour stockage
 * Format : "06 12 34 56 78, 07 98 76 54 32"
 *
 * @param phones - Tableau de numéros normalisés
 * @returns Chaîne formatée ou undefined
 */
export function formatPhoneNumbers(phones: string[] | undefined): string | undefined {
  if (!phones || phones.length === 0) return undefined;

  // Formater chaque numéro pour l'affichage
  const formatted = phones.map(formatPhoneForDisplay);

  return formatted.join(', ');
}

/**
 * Formate un numéro de téléphone pour l'affichage
 * - Numéros français : 06 12 34 56 78
 * - Numéros internationaux : +33 6 12 34 56 78
 *
 * @param phone - Numéro normalisé
 * @returns Numéro formaté
 */
function formatPhoneForDisplay(phone: string): string {
  // Numéros internationaux
  if (phone.startsWith('+')) {
    // +33612345678 → +33 6 12 34 56 78
    // Extraire le code pays (1-3 chiffres après le +)
    const match = phone.match(/^\+(\d{1,3})(\d+)$/);
    if (match && match[1] && match[2]) {
      const countryCode = match[1];
      const rest = match[2];

      // Formater le reste par paires : 612345678 → 6 12 34 56 78
      const formattedRest = rest.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
      return `+${countryCode} ${formattedRest}`;
    }
    return phone;
  }

  // Numéros français 10 chiffres : 0612345678 → 06 12 34 56 78
  if (/^0\d{9}$/.test(phone)) {
    return phone.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  }

  // Autres : grouper par 2
  return phone.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

/**
 * Teste si une chaîne contient au moins un numéro de téléphone valide
 *
 * @param input - Chaîne à tester
 * @returns true si au moins un numéro trouvé
 */
export function hasPhoneNumber(input: string | undefined): boolean {
  const phones = parsePhoneNumbers(input);
  return phones !== undefined && phones.length > 0;
}
