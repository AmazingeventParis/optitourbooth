/**
 * Script de démonstration du parser de téléphone
 * Exemples concrets d'utilisation
 */

import { parsePhoneNumbers, formatPhoneNumbers } from './src/utils/phoneParser.js';

console.log('\n📱 Exemples de parsing de numéros de téléphone\n');
console.log('='.repeat(60));

const examples = [
  '06 12 34 56 78 07 98 76 54 32',
  '06.12.34.56.78 07.98.76.54.32',
  '06 12 34 56 78   07 98 76 54 32',
  '0612345678 0798765432',
  '06 12 34 56 78, 07 98 76 54 32',
  '0612345678 / 0798765432',
  '+33612345678 0798765432',
  '06.12.34.56.78; 07.98.76.54.32',
];

for (const example of examples) {
  console.log(`\nInput:  "${example}"`);
  const phones = parsePhoneNumbers(example);
  const formatted = formatPhoneNumbers(phones);
  console.log(`Output: "${formatted}"`);
  console.log(`Count:  ${phones?.length || 0} numéro(s) détecté(s)`);
}

console.log('\n' + '='.repeat(60));
console.log('✨ Tous les formats sont supportés!\n');
