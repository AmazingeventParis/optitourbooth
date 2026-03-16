import { PrismaClient, MachineType, TenantPlan } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Début du seeding...');

  // ===== TENANT =====
  const shootnboxTenant = await prisma.tenant.upsert({
    where: { slug: 'shootnbox' },
    update: {},
    create: {
      name: 'Shootnbox',
      slug: 'shootnbox',
      plan: TenantPlan.PRO,
      config: {
        modules: { tournees: true, preparations: true, vehicules: true, produits: true, rapports: true, gps: true, notifications: true },
        limits: { maxUsers: 50, maxChauffeurs: 20, maxVehicules: 20 },
      },
      active: true,
    },
  });
  console.log(`✅ Tenant créé: ${shootnboxTenant.name} (${shootnboxTenant.slug})`);

  // ===== NETTOYAGE : supprimer les anciens comptes de test =====
  const obsoleteEmails = [
    'vincent.pixerelle@gmail.com',
    'admin@shootnbox.fr',
    'chauffeur@shootnbox.fr',
  ];
  const deleted = await prisma.user.deleteMany({
    where: { email: { in: obsoleteEmails } },
  });
  if (deleted.count > 0) {
    console.log(`🗑️  ${deleted.count} ancien(s) compte(s) de test supprimé(s)`);
  }

  // ===== SUPERADMIN (seul compte créé par le seed) =====
  const superAdminPassword = await bcrypt.hash('SuperAdmin1!', 12);
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@optitour.fr' },
    update: {},
    create: {
      email: 'superadmin@optitour.fr',
      passwordHash: superAdminPassword,
      roles: ['superadmin'],
      nom: 'Super',
      prenom: 'Admin',
      telephone: null,
      tenantId: null, // superadmin n'appartient à aucun tenant
      actif: true,
    },
  });
  console.log(`✅ Super Admin créé: ${superAdmin.email}`);

  // ===== WAREHOUSE (bureau@shootnbox.fr) =====
  const warehousePassword = await bcrypt.hash('Laurytal2', 12);
  const warehouseUser = await prisma.user.upsert({
    where: { email: 'bureau@shootnbox.fr' },
    update: {},
    create: {
      email: 'bureau@shootnbox.fr',
      passwordHash: warehousePassword,
      roles: ['warehouse'],
      nom: 'Bureau',
      prenom: 'Shootnbox',
      telephone: null,
      tenantId: shootnboxTenant.id,
      actif: true,
    },
  });
  console.log(`✅ Warehouse créé: ${warehouseUser.email}`);

  // ===== NETTOYAGE : supprimer les anciens produits de test =====
  const oldProduits = ['Photobooth Classic', 'Photobooth Miroir', 'Photobooth 360', 'Photobooth Compact'];
  for (const nom of oldProduits) {
    try {
      await prisma.produit.delete({ where: { nom } });
      console.log(`🗑️ Ancien produit supprimé: ${nom}`);
    } catch {
      // Produit déjà supprimé ou inexistant
    }
  }

  // ===== NETTOYAGE : supprimer les anciens clients de test =====
  const oldTestClients = [
    'Salle des Fêtes de Paris',
    'Château de Versailles Events',
    'Hôtel Le Meurice',
    'Domaine de Chantilly',
    'La Défense Arena',
    'Pavillon Royal Bois de Boulogne',
    'Hippodrome de Longchamp',
    'Stade de France',
    'Parc Floral de Vincennes',
    'Château de Fontainebleau',
    'Musée du Louvre',
    'Grand Palais',
    'Palais des Congrès Issy',
    'Palais des Congrès Paris',
    'Château de Vaux-le-Vicomte',
    'AccorHotels Arena Bercy',
    'Mairie de Neuilly-sur-Seine',
    'Orangerie du Château de Sceaux',
  ];
  for (const nom of oldTestClients) {
    try {
      await prisma.client.deleteMany({ where: { nom } });
      console.log(`🗑️ Ancien client test supprimé: ${nom}`);
    } catch {
      // Client déjà supprimé ou a des relations
    }
  }

  // ===== MACHINES =====
  console.log('\n🎰 Création des machines...');

  // 35 Vegas (V1 à V35)
  for (let i = 1; i <= 35; i++) {
    const numero = `V${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Vegas, numero } },
      update: {},
      create: {
        type: MachineType.Vegas,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 35 machines Vegas créées (V1-V35)');

  // 20 Smakk (SK1 à SK20)
  for (let i = 1; i <= 20; i++) {
    const numero = `SK${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Smakk, numero } },
      update: {},
      create: {
        type: MachineType.Smakk,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 20 machines Smakk créées (SK1-SK20)');

  // 10 Ring (R1 à R10)
  for (let i = 1; i <= 10; i++) {
    const numero = `R${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Ring, numero } },
      update: {},
      create: {
        type: MachineType.Ring,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 10 machines Ring créées (R1-R10)');

  // 5 Miroir (MI1 à MI5)
  for (let i = 1; i <= 5; i++) {
    const numero = `MI${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Miroir, numero } },
      update: {},
      create: {
        type: MachineType.Miroir,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 5 machines Miroir créées (MI1-MI5)');

  // 3 Playbox (PB1 à PB3)
  for (let i = 1; i <= 3; i++) {
    const numero = `PB${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Playbox, numero } },
      update: {},
      create: {
        type: MachineType.Playbox,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 3 machines Playbox créées (PB1-PB3)');

  // 2 Aircam (AC1 à AC2)
  for (let i = 1; i <= 2; i++) {
    const numero = `AC${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Aircam, numero } },
      update: {},
      create: {
        type: MachineType.Aircam,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 2 machines Aircam créées (AC1-AC2)');

  // 3 Spinner (SP1 à SP3)
  for (let i = 1; i <= 3; i++) {
    const numero = `SP${i}`;
    await prisma.machine.upsert({
      where: { type_numero: { type: MachineType.Spinner, numero } },
      update: {},
      create: {
        type: MachineType.Spinner,
        numero,
        actif: true,
      },
    });
  }
  console.log('✅ 3 machines Spinner créées (SP1-SP3)');

  console.log('');
  console.log('🎉 Seeding terminé !');
  console.log('');
  console.log('📧 Comptes créés:');
  console.log('   Super Admin: superadmin@optitour.fr / SuperAdmin1!');
  console.log('   Warehouse:   bureau@shootnbox.fr / Laurytal2');
  console.log('   (Les autres comptes doivent être créés manuellement via l\'interface)');
}

main()
  .catch((e) => {
    console.error('❌ Erreur pendant le seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
