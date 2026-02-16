/**
 * Script de réparation des tournées avec mauvais timezone
 * Exécution: npx tsx src/scripts/fix-tournees-timezone.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTournees() {
  try {
    console.log('🔍 Recherche des tournées avec date incorrecte (timezone local au lieu d\'UTC)...\n');

    // Date d'hier 23:00 UTC = aujourd'hui minuit Paris (problème de timezone)
    const dateFausse = new Date('2026-02-15T23:00:00.000Z');
    const dateCorrecte = new Date('2026-02-16T00:00:00.000Z');

    // Trouver toutes les tournées avec cette date incorrecte
    const tourneesAReparer = await prisma.tournee.findMany({
      where: {
        date: dateFausse,
      },
      include: {
        chauffeur: {
          select: {
            prenom: true,
            nom: true,
          }
        },
        points: {
          select: {
            id: true,
          }
        }
      }
    });

    console.log(`📋 Trouvé ${tourneesAReparer.length} tournée(s) à réparer:\n`);

    if (tourneesAReparer.length === 0) {
      console.log('✅ Aucune tournée à réparer. Tout est OK !\n');
      return;
    }

    // Afficher les tournées trouvées
    tourneesAReparer.forEach(t => {
      console.log(`  - ${t.chauffeur.prenom} ${t.chauffeur.nom}:`);
      console.log(`    ID: ${t.id}`);
      console.log(`    Statut: ${t.statut}`);
      console.log(`    Date actuelle: ${t.date.toISOString()}`);
      console.log(`    Points: ${t.points.length}`);
      console.log('');
    });

    console.log('🔧 Correction en cours...\n');

    // Corriger chaque tournée
    for (const tournee of tourneesAReparer) {
      const updateData: {
        date: Date;
        statut?: 'en_cours';
        heureFinReelle?: null;
      } = {
        date: dateCorrecte,
      };

      // Si la tournée était terminée par erreur, la remettre en cours
      if (tournee.statut === 'terminee') {
        updateData.statut = 'en_cours';
        updateData.heureFinReelle = null;
      }

      await prisma.tournee.update({
        where: { id: tournee.id },
        data: updateData
      });

      console.log(`✅ ${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}:`);
      console.log(`   Date: ${dateFausse.toISOString()} → ${dateCorrecte.toISOString()}`);
      if (updateData.statut) {
        console.log(`   Statut: terminee → ${updateData.statut}`);
      }
      console.log('');
    }

    console.log('🎉 Réparation terminée ! Les tournées apparaissent maintenant dans le planning d\'aujourd\'hui.\n');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTournees();
