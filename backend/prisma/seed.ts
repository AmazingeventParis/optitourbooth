import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Début du seeding...');

  // Créer l'utilisateur admin principal (Vincent)
  const vincentPassword = await bcrypt.hash('testtesT1!', 12);
  const vincent = await prisma.user.upsert({
    where: { email: 'vincent.pixerelle@gmail.com' },
    update: {},
    create: {
      email: 'vincent.pixerelle@gmail.com',
      passwordHash: vincentPassword,
      role: UserRole.admin,
      nom: 'Pixerelle',
      prenom: 'Vincent',
      telephone: '0600000000',
      actif: true,
    },
  });
  console.log(`✅ Admin créé: ${vincent.email}`);

  // Créer l'utilisateur admin de test
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@shootnbox.fr' },
    update: {},
    create: {
      email: 'admin@shootnbox.fr',
      passwordHash: adminPassword,
      role: UserRole.admin,
      nom: 'Admin',
      prenom: 'Shootnbox',
      telephone: '0600000001',
      actif: true,
    },
  });
  console.log(`✅ Admin test créé: ${admin.email}`);

  // Créer un chauffeur de test
  const chauffeurPassword = await bcrypt.hash('chauffeur123', 12);
  const chauffeur = await prisma.user.upsert({
    where: { email: 'chauffeur@shootnbox.fr' },
    update: {},
    create: {
      email: 'chauffeur@shootnbox.fr',
      passwordHash: chauffeurPassword,
      role: UserRole.chauffeur,
      nom: 'Dupont',
      prenom: 'Jean',
      telephone: '0611111111',
      actif: true,
    },
  });
  console.log(`✅ Chauffeur créé: ${chauffeur.email}`);

  // Créer quelques produits de base
  const produits = [
    {
      nom: 'Photobooth Classic',
      reference: 'PB-CLASSIC',
      description: 'Borne photobooth classique avec impression instantanée',
      dureeInstallation: 30,
      dureeDesinstallation: 20,
      poids: 45,
      largeur: 60,
      hauteur: 180,
      profondeur: 60,
    },
    {
      nom: 'Photobooth Miroir',
      reference: 'PB-MIRROR',
      description: 'Borne photobooth miroir interactif',
      dureeInstallation: 45,
      dureeDesinstallation: 30,
      poids: 65,
      largeur: 80,
      hauteur: 200,
      profondeur: 15,
    },
    {
      nom: 'Photobooth 360',
      reference: 'PB-360',
      description: 'Plateforme 360° pour vidéos rotatives',
      dureeInstallation: 60,
      dureeDesinstallation: 45,
      poids: 80,
      largeur: 150,
      hauteur: 100,
      profondeur: 150,
    },
    {
      nom: 'Photobooth Compact',
      reference: 'PB-COMPACT',
      description: 'Borne photobooth compacte et légère',
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
      where: { reference: produit.reference },
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

  console.log('');
  console.log('🎉 Seeding terminé !');
  console.log('');
  console.log('📧 Comptes créés:');
  console.log('   Admin: vincent.pixerelle@gmail.com / testtesT1!');
  console.log('   Admin test: admin@shootnbox.fr / admin123');
  console.log('   Chauffeur: chauffeur@shootnbox.fr / chauffeur123');
}

main()
  .catch((e) => {
    console.error('❌ Erreur pendant le seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
