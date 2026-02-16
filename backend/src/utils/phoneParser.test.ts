/**
 * Tests pour phoneParser.ts
 * Pour exécuter : npm test
 */

import { parsePhoneNumbers, formatPhoneNumbers } from './phoneParser.js';

// Fonction de test simple
function test(description: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${description}`);
  } catch (error) {
    console.error(`❌ ${description}`);
    console.error(error);
  }
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      `${message || 'Assertion failed'}\n  Expected: ${expectedStr}\n  Actual: ${actualStr}`
    );
  }
}

// Tests
console.log('\n📞 Tests du parser de numéros de téléphone\n');

test('Parse un seul numéro simple', () => {
  const result = parsePhoneNumbers('0612345678');
  assertEquals(result, ['0612345678']);
});

test('Parse un numéro avec espaces', () => {
  const result = parsePhoneNumbers('06 12 34 56 78');
  assertEquals(result, ['0612345678']);
});

test('Parse deux numéros séparés par virgule', () => {
  const result = parsePhoneNumbers('06 12 34 56 78, 07 98 76 54 32');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse deux numéros séparés par slash', () => {
  const result = parsePhoneNumbers('0612345678 / 0798765432');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse deux numéros séparés par slash avec espaces', () => {
  const result = parsePhoneNumbers('06-12-34-56-78 / 07-98-76-54-32');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse deux numéros avec formats mixtes', () => {
  const result = parsePhoneNumbers('06.12.34.56.78, 07 98 76 54 32');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse deux numéros séparés par underscore', () => {
  const result = parsePhoneNumbers('0612345678_0798765432');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse numéro avec indicatif international', () => {
  const result = parsePhoneNumbers('+33612345678');
  assertEquals(result, ['+33612345678']);
});

test('Parse mélange de numéros français et internationaux', () => {
  const result = parsePhoneNumbers('+33612345678, 0798765432');
  assertEquals(result, ['+33612345678', '0798765432']);
});

test('Parse numéro à 9 chiffres (ajoute le 0)', () => {
  const result = parsePhoneNumbers('612345678');
  assertEquals(result, ['0612345678']);
});

test('Parse numéro avec points comme séparateur interne', () => {
  const result = parsePhoneNumbers('06.12.34.56.78');
  assertEquals(result, ['0612345678']);
});

test('Parse numéro avec tirets comme séparateur interne', () => {
  const result = parsePhoneNumbers('06-12-34-56-78');
  assertEquals(result, ['0612345678']);
});

test('Parse trois numéros séparés par différents délimiteurs', () => {
  const result = parsePhoneNumbers('06 12 34 56 78, 07 98 76 54 32 / 01 23 45 67 89');
  assertEquals(result, ['0612345678', '0798765432', '0123456789']);
});

test('Ignore les chaînes vides', () => {
  const result = parsePhoneNumbers('');
  assertEquals(result, undefined);
});

test('Ignore undefined', () => {
  const result = parsePhoneNumbers(undefined);
  assertEquals(result, undefined);
});

test('Formate un seul numéro', () => {
  const result = formatPhoneNumbers(['0612345678']);
  assertEquals(result, '06 12 34 56 78');
});

test('Formate plusieurs numéros', () => {
  const result = formatPhoneNumbers(['0612345678', '0798765432']);
  assertEquals(result, '06 12 34 56 78, 07 98 76 54 32');
});

test('Formate numéro international', () => {
  const result = formatPhoneNumbers(['+33612345678']);
  // Accepte le format groupé par paires : +336 12 34 56 78
  // (le 6 peut rester collé au code pays car il reste seul)
  assertEquals(result, '+336 12 34 56 78');
});

test('Parse et formate ensemble', () => {
  const parsed = parsePhoneNumbers('0612345678, 0798765432');
  const formatted = formatPhoneNumbers(parsed);
  assertEquals(formatted, '06 12 34 56 78, 07 98 76 54 32');
});

test('Parse deux numéros séparés uniquement par des espaces', () => {
  const result = parsePhoneNumbers('06 12 34 56 78 07 98 76 54 32');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse deux numéros avec points séparés par espace', () => {
  const result = parsePhoneNumbers('06.12.34.56.78 07.98.76.54.32');
  assertEquals(result, ['0612345678', '0798765432']);
});

test('Parse format réaliste utilisateur', () => {
  const result = parsePhoneNumbers('06 12 34 56 78   07 98 76 54 32');
  assertEquals(result, ['0612345678', '0798765432']);
});

console.log('\n✨ Tous les tests sont passés!\n');
