import { PrismaClient, MachineType } from '@prisma/client';

const prisma = new PrismaClient();

// Couleurs par type de machine (synchronisées avec les produits)
const MACHINE_COLORS: Record<MachineType, string> = {
  Vegas: '#616161',   // Graphite
  Smakk: '#F6BF26',   // Banane
  Ring: '#8E24AA',    // Raisin
  Miroir: '#F4511E',  // Mandarine
  Playbox: '#E67C73', // Flamant
  Aircam: '#3F51B5',  // Myrtille
  Spinner: '#0B8043', // Basilic
};

async function main() {
  console.log('🎨 Mise à jour des couleurs des machines...\n');

  for (const [type, couleur] of Object.entries(MACHINE_COLORS)) {
    const result = await prisma.machine.updateMany({
      where: { type: type as MachineType },
      data: { couleur },
    });

    console.log(`✅ ${result.count} machines ${type} → ${couleur}`);
  }

  console.log('\n✨ Couleurs mises à jour avec succès !');
}

main()
  .catch((e) => {
    console.error('❌ Erreur:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
