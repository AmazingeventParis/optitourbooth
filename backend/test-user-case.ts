/**
 * Test du cas spécifique de l'utilisateur
 */

import { parsePhoneNumbers, formatPhoneNumbers } from './src/utils/phoneParser.js';

console.log('\n📱 Test du cas utilisateur\n');
console.log('='.repeat(60));

const testCase = '0641652451 / 01.78.45.22.98-0798563422';

console.log(`\nInput:  "${testCase}"`);

const phones = parsePhoneNumbers(testCase);
console.log(`Parsed: ${JSON.stringify(phones)}`);

const formatted = formatPhoneNumbers(phones);
console.log(`Output: "${formatted}"`);

console.log(`Count:  ${phones?.length || 0} numéro(s) détecté(s)`);

if (phones && phones.length === 3) {
  console.log('\n✅ SUCCESS: 3 numéros détectés comme attendu!');
  console.log('  1. 0641652451');
  console.log('  2. 01.78.45.22.98');
  console.log('  3. 0798563422');
} else {
  console.log('\n❌ FAILED: Devrait détecter 3 numéros');
}

console.log('\n' + '='.repeat(60) + '\n');
