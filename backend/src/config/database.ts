import { PrismaClient } from '@prisma/client';

// Instance unique du client Prisma (singleton)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Fonction pour tester la connexion
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('✅ Connexion à PostgreSQL établie');
  } catch (error) {
    console.error('❌ Erreur de connexion à PostgreSQL:', error);
    process.exit(1);
  }
}

// Fonction pour fermer la connexion proprement
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 Déconnexion de PostgreSQL');
}
