#!/bin/sh
set -e

echo "=== OptiTour Booth - Démarrage ==="

echo "[1/3] Synchronisation du schéma de base de données..."
prisma db push

echo "[2/3] Vérification des données initiales..."
USER_COUNT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count()
  .then(c => { process.stdout.write(String(c)); p.\$disconnect(); })
  .catch(() => { process.stdout.write('0'); });
")

if [ "$USER_COUNT" = "0" ]; then
  echo "Aucun utilisateur trouvé - lancement du seed initial..."
  npx tsx prisma/seed.ts
else
  echo "Base de données déjà initialisée ($USER_COUNT utilisateur(s) trouvé(s))"
fi

# Reset admin password if RESET_ADMIN_PASSWORD is set
if [ -n "$RESET_ADMIN_PASSWORD" ]; then
  echo "[RESET] Réinitialisation du mot de passe admin..."
  node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.env.RESET_ADMIN_PASSWORD, 12);
  const result = await p.user.updateMany({
    where: { roles: { has: 'admin' } },
    data: { passwordHash: hash }
  });
  console.log('[RESET] ' + result.count + ' admin(s) mis à jour avec le nouveau mot de passe');
  await p.\$disconnect();
})().catch(e => { console.error('[RESET] Erreur:', e.message); process.exit(0); });
"
fi

echo "[3/3] Démarrage de l'application..."
exec node dist/app.js
