import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findArieTournee() {
  try {
    console.log('🔍 Recherche des tournées d\'Arié (14-17 février)...\n');

    const tournees = await prisma.tournee.findMany({
      where: {
        chauffeur: {
          OR: [
            { prenom: { contains: 'ari', mode: 'insensitive' } },
            { nom: { contains: 'ari', mode: 'insensitive' } }
          ]
        },
        date: {
          gte: new Date('2026-02-14T00:00:00.000Z'),
          lte: new Date('2026-02-17T00:00:00.000Z')
        }
      },
      include: {
        chauffeur: true,
        points: true
      }
    });

    if (tournees.length === 0) {
      console.log('❌ Aucune tournée trouvée pour Arié dans cette période.\n');

      // Chercher toutes les tournées d'Arié
      const allTournees = await prisma.tournee.findMany({
        where: {
          chauffeur: {
            OR: [
              { prenom: { contains: 'ari', mode: 'insensitive' } },
              { nom: { contains: 'ari', mode: 'insensitive' } }
            ]
          }
        },
        include: {
          chauffeur: true
        },
        orderBy: {
          date: 'desc'
        },
        take: 5
      });

      console.log(`📋 Dernières tournées d'Arié:`);
      allTournees.forEach(t => {
        console.log(`  - ${t.date.toISOString().split('T')[0]}: ${t.statut} (${t.id})`);
      });

    } else {
      console.log(`📋 Trouvé ${tournees.length} tournée(s):\n`);

      tournees.forEach(t => {
        console.log(`  ID: ${t.id}`);
        console.log(`  Chauffeur: ${t.chauffeur.prenom} ${t.chauffeur.nom}`);
        console.log(`  Date: ${t.date.toISOString()}`);
        console.log(`  Statut: ${t.statut}`);
        console.log(`  Points: ${t.points.length}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findArieTournee();
