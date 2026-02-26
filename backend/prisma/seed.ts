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

  // Créer quelques produits de base
  const produits = [
    {
      nom: 'Photobooth Classic',
      dureeInstallation: 30,
      dureeDesinstallation: 20,
      poids: 45,
      largeur: 60,
      hauteur: 180,
      profondeur: 60,
    },
    {
      nom: 'Photobooth Miroir',
      dureeInstallation: 45,
      dureeDesinstallation: 30,
      poids: 65,
      largeur: 80,
      hauteur: 200,
      profondeur: 15,
    },
    {
      nom: 'Photobooth 360',
      dureeInstallation: 60,
      dureeDesinstallation: 45,
      poids: 80,
      largeur: 150,
      hauteur: 100,
      profondeur: 150,
    },
    {
      nom: 'Photobooth Compact',
      dureeInstallation: 20,
      dureeDesinstallation: 15,
      poids: 25,
      largeur: 40,
      hauteur: 150,
      profondeur: 40,
    },
  ];

  for (const produit of produits) {
    const created = await prisma.produit.upsert({
      where: { nom: produit.nom },
      update: {},
      create: produit,
    });
    console.log(`✅ Produit créé: ${created.nom}`);
  }

  // Créer des clients de test en Île-de-France
  const clients = [
    {
      nom: 'Salle des Fêtes de Paris',
      email: 'contact@sallefetes-paris.fr',
      telephone: '0140000001',
      adresse: '12 Rue de la Mairie',
      codePostal: '75001',
      ville: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
      instructionsAcces: 'Entrée par le parking arrière',
    },
    {
      nom: 'Château de Versailles Events',
      email: 'events@versailles.fr',
      telephone: '0139000002',
      adresse: 'Place d\'Armes',
      codePostal: '78000',
      ville: 'Versailles',
      latitude: 48.8049,
      longitude: 2.1204,
      instructionsAcces: 'Badge requis - contacter le régisseur',
    },
    {
      nom: 'Hôtel Le Meurice',
      email: 'events@lemeurice.com',
      telephone: '0144000003',
      adresse: '228 Rue de Rivoli',
      codePostal: '75001',
      ville: 'Paris',
      latitude: 48.8651,
      longitude: 2.3281,
      instructionsAcces: 'Entrée de service rue de Castiglione',
    },
    {
      nom: 'Domaine de Chantilly',
      email: 'events@domainechantilly.com',
      telephone: '0344000005',
      adresse: '7 Rue du Connétable',
      codePostal: '60500',
      ville: 'Chantilly',
      latitude: 49.1945,
      longitude: 2.4865,
      instructionsAcces: 'Entrée par les écuries',
    },
    {
      nom: 'La Défense Arena',
      email: 'technique@ladefensearena.fr',
      telephone: '0147000006',
      adresse: '99 Jardins de l\'Arche',
      codePostal: '92000',
      ville: 'Nanterre',
      latitude: 48.8958,
      longitude: 2.2296,
      instructionsAcces: 'Accès livraison porte 12',
    },
    {
      nom: 'Pavillon Royal Bois de Boulogne',
      email: 'contact@pavillonroyal.fr',
      telephone: '0145000007',
      adresse: 'Route de Suresnes',
      codePostal: '75016',
      ville: 'Paris',
      latitude: 48.8642,
      longitude: 2.2494,
      instructionsAcces: 'Suivre les panneaux Pavillon Royal',
    },
    {
      nom: 'Hippodrome de Longchamp',
      email: 'events@france-galop.com',
      telephone: '0144000008',
      adresse: '2 Route des Tribunes',
      codePostal: '75016',
      ville: 'Paris',
      latitude: 48.8571,
      longitude: 2.2298,
      instructionsAcces: 'Badge obligatoire - retrait accueil VIP',
    },
    {
      nom: 'Stade de France',
      email: 'technique@stadefrance.com',
      telephone: '0155000009',
      adresse: '93216 Saint-Denis',
      codePostal: '93200',
      ville: 'Saint-Denis',
      latitude: 48.9244,
      longitude: 2.3600,
      instructionsAcces: 'Entrée fournisseurs porte H',
    },
    {
      nom: 'Parc Floral de Vincennes',
      email: 'events@parcfloral.paris.fr',
      telephone: '0143000010',
      adresse: 'Route de la Pyramide',
      codePostal: '75012',
      ville: 'Paris',
      latitude: 48.8383,
      longitude: 2.4453,
      instructionsAcces: 'Entrée véhicules par la porte de Reuilly',
    },
    {
      nom: 'Château de Fontainebleau',
      email: 'events@chateaufontainebleau.fr',
      telephone: '0160000011',
      adresse: 'Place du Général de Gaulle',
      codePostal: '77300',
      ville: 'Fontainebleau',
      latitude: 48.4025,
      longitude: 2.7016,
      instructionsAcces: 'Cour des Offices - contacter intendance',
    },
    {
      nom: 'Musée du Louvre',
      email: 'evenements@louvre.fr',
      telephone: '0140000012',
      adresse: 'Rue de Rivoli',
      codePostal: '75001',
      ville: 'Paris',
      latitude: 48.8606,
      longitude: 2.3376,
      instructionsAcces: 'Entrée Passage Richelieu',
    },
    {
      nom: 'Grand Palais',
      email: 'technique@grandpalais.fr',
      telephone: '0144000013',
      adresse: '3 Avenue du Général Eisenhower',
      codePostal: '75008',
      ville: 'Paris',
      latitude: 48.8661,
      longitude: 2.3125,
      instructionsAcces: 'Accès artistes avenue Dutuit',
    },
    {
      nom: 'Palais des Congrès Issy',
      email: 'events@palaisissy.fr',
      telephone: '0146000014',
      adresse: '25 Avenue Victor Cresson',
      codePostal: '92130',
      ville: 'Issy-les-Moulineaux',
      latitude: 48.8247,
      longitude: 2.2735,
      instructionsAcces: 'Parking souterrain niveau -2',
    },
    {
      nom: 'Château de Vaux-le-Vicomte',
      email: 'events@vfrere-vicomte.com',
      telephone: '0164000015',
      adresse: 'Château de Vaux-le-Vicomte',
      codePostal: '77950',
      ville: 'Maincy',
      latitude: 48.5658,
      longitude: 2.7139,
      instructionsAcces: 'Entrée de service côté communs',
    },
    {
      nom: 'AccorHotels Arena Bercy',
      email: 'technique@accorhotelsarena.com',
      telephone: '0144000016',
      adresse: '8 Boulevard de Bercy',
      codePostal: '75012',
      ville: 'Paris',
      latitude: 48.8387,
      longitude: 2.3783,
      instructionsAcces: 'Quai de déchargement niveau -1',
    },
    {
      nom: 'Mairie de Neuilly-sur-Seine',
      email: 'events@neuillysurseine.fr',
      telephone: '0147000017',
      adresse: '96 Avenue Achille Peretti',
      codePostal: '92200',
      ville: 'Neuilly-sur-Seine',
      latitude: 48.8848,
      longitude: 2.2679,
      instructionsAcces: 'Salle des mariages - entrée latérale',
    },
    {
      nom: 'Orangerie du Château de Sceaux',
      email: 'events@domaine-de-sceaux.fr',
      telephone: '0141000018',
      adresse: '8 Avenue Claude Perrault',
      codePostal: '92330',
      ville: 'Sceaux',
      latitude: 48.7744,
      longitude: 2.2989,
      instructionsAcces: 'Portail du parc côté Orangerie',
    },
  ];

  for (const client of clients) {
    const created = await prisma.client.upsert({
      where: { id: client.nom }, // Will fail on first run, creating new
      update: {},
      create: client,
    });
    console.log(`✅ Client créé: ${created.nom}`);
  }

  // Créer les machines photobooth
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

  console.log('');
  console.log('🎉 Seeding terminé !');
  console.log('');
  console.log('📧 Compte créé:');
  console.log('   Super Admin: superadmin@optitour.fr / SuperAdmin1!');
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
