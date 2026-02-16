/**
 * Tests pour les utilitaires de dates UTC
 */

import { describe, it, expect } from 'vitest';
import {
  ensureDateUTC,
  timeToUTCDateTime,
  parseUTCDate,
  formatDateUTC,
  isUTCMidnight,
} from './dateUtils';

describe('dateUtils - Garantie UTC pour éviter bugs timezone', () => {
  describe('ensureDateUTC', () => {
    it('convertit une date YYYY-MM-DD en UTC minuit', () => {
      const result = ensureDateUTC('2026-02-16');

      expect(result.toISOString()).toBe('2026-02-16T00:00:00.000Z');
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });

    it('gère les dates avec T00:00:00.000Z', () => {
      const result = ensureDateUTC('2026-02-16T00:00:00.000Z');
      expect(result.toISOString()).toBe('2026-02-16T00:00:00.000Z');
    });

    it('ajoute Z si manquant', () => {
      const result = ensureDateUTC('2026-02-16T12:30:00');
      expect(result.toISOString()).toBe('2026-02-16T12:30:00.000Z');
    });

    it('ne crée JAMAIS une date en timezone locale', () => {
      const result = ensureDateUTC('2026-02-16');

      // Si on était en Paris (UTC+1), une mauvaise implémentation créerait
      // 2026-02-15T23:00:00.000Z. On vérifie que ça n'arrive jamais.
      expect(result.getUTCDate()).toBe(16);
      expect(result.getUTCMonth()).toBe(1); // Février = 1
      expect(result.getUTCFullYear()).toBe(2026);
    });
  });

  describe('timeToUTCDateTime', () => {
    const referenceDate = new Date('2026-02-16T00:00:00.000Z');

    it('convertit une heure HH:MM en DateTime UTC', () => {
      const result = timeToUTCDateTime('14:30', referenceDate);

      expect(result).toBeDefined();
      expect(result!.toISOString()).toBe('2026-02-16T14:30:00.000Z');
      expect(result!.getUTCHours()).toBe(14);
      expect(result!.getUTCMinutes()).toBe(30);
    });

    it('gère les heures sans zéro (9:05)', () => {
      const result = timeToUTCDateTime('9:05', referenceDate);
      expect(result!.toISOString()).toBe('2026-02-16T09:05:00.000Z');
    });

    it('retourne undefined pour string vide', () => {
      expect(timeToUTCDateTime('', referenceDate)).toBeUndefined();
      expect(timeToUTCDateTime(undefined, referenceDate)).toBeUndefined();
    });

    it('retourne undefined pour format invalide', () => {
      expect(timeToUTCDateTime('25:00', referenceDate)).toBeUndefined();
      expect(timeToUTCDateTime('12:60', referenceDate)).toBeUndefined();
      expect(timeToUTCDateTime('abc', referenceDate)).toBeUndefined();
    });

    it('utilise TOUJOURS UTC et non timezone locale', () => {
      const result = timeToUTCDateTime('14:30', referenceDate);

      // Vérifier que getUTCHours retourne la même valeur que ce qu'on a passé
      // Si ça utilisait setHours (locale), on aurait un décalage
      expect(result!.getUTCHours()).toBe(14);

      // En France (UTC+1), si on utilisait setHours(14, 30),
      // getUTCHours() retournerait 13 au lieu de 14
      // On vérifie que ça n'arrive JAMAIS
      expect(result!.getUTCHours()).not.toBe(13);
    });
  });

  describe('formatDateUTC', () => {
    it('formate une date en YYYY-MM-DD (UTC)', () => {
      const date = new Date('2026-02-16T14:30:00.000Z');
      expect(formatDateUTC(date)).toBe('2026-02-16');
    });

    it('utilise les valeurs UTC et non locales', () => {
      // Date à 23:00 UTC le 15 février
      // En France (UTC+1), c'est minuit le 16 février localement
      // Mais formatDateUTC doit retourner le 15 (UTC)
      const date = new Date('2026-02-15T23:00:00.000Z');
      expect(formatDateUTC(date)).toBe('2026-02-15');
    });
  });

  describe('isUTCMidnight', () => {
    it('retourne true pour minuit UTC exact', () => {
      const date = new Date('2026-02-16T00:00:00.000Z');
      expect(isUTCMidnight(date)).toBe(true);
    });

    it('retourne false si pas exactement minuit UTC', () => {
      expect(isUTCMidnight(new Date('2026-02-16T00:00:01.000Z'))).toBe(false);
      expect(isUTCMidnight(new Date('2026-02-16T14:30:00.000Z'))).toBe(false);
      expect(isUTCMidnight(new Date('2026-02-16T00:00:00.001Z'))).toBe(false);
    });
  });

  describe('Scénarios réels - Bug timezone', () => {
    it('CRITIQUE: date de tournée doit être minuit UTC, pas minuit local', () => {
      // Simuler la création d'une tournée pour le 16 février
      const dateFromFrontend = '2026-02-16';
      const dateTournee = ensureDateUTC(dateFromFrontend);

      // La date DOIT être 2026-02-16T00:00:00.000Z
      expect(dateTournee.toISOString()).toBe('2026-02-16T00:00:00.000Z');

      // Si on était en France (UTC+1) et qu'on utilisait new Date() sans forcer UTC,
      // on aurait 2026-02-15T23:00:00.000Z
      // Ce test garantit que ça n'arrive JAMAIS
      expect(dateTournee.getUTCDate()).toBe(16);
      expect(dateTournee.getUTCHours()).toBe(0);
    });

    it('CRITIQUE: autoFinishPastTournees ne doit pas terminer les tournées d\'aujourd\'hui', () => {
      // Aujourd'hui = 16 février 2026
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0); // Minuit UTC aujourd'hui

      // Une tournée créée pour aujourd'hui
      const tourneeDateStr = '2026-02-16';
      const tourneeDate = ensureDateUTC(tourneeDateStr);

      // La tournée NE DOIT PAS être considérée comme passée
      // tourneeDate < today doit être FALSE
      expect(tourneeDate < today).toBe(false);

      // Une tournée d'hier DOIT être passée
      const tourneeHier = ensureDateUTC('2026-02-15');
      expect(tourneeHier < today).toBe(true);
    });
  });
});
