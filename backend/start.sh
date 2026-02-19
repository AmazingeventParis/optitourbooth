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
# Also fixes roles array (migration from role -> roles column)
if [ -n "$RESET_ADMIN_PASSWORD" ]; then
  echo "[RESET] Réinitialisation des comptes admins..."
  node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.env.RESET_ADMIN_PASSWORD, 12);
  // Fix roles for all users (prisma db push adds roles=[preparateur] by default)
  // We identify admins by common admin emails
  const adminEmails = (process.env.RESET_ADMIN_EMAILS || 'vincent.pixerelle@gmail.com').split(',').map(e => e.trim());
  for (const email of adminEmails) {
    const user = await p.user.findUnique({ where: { email } });
    if (user) {
      await p.user.update({
        where: { email },
        data: { passwordHash: hash, roles: ['admin'] }
      });
      console.log('[RESET] Admin mis à jour: ' + email);
    } else {
      // Create if not exists
      await p.user.create({
        data: {
          email,
          passwordHash: hash,
          roles: ['admin'],
          nom: email.split('@')[0],
          prenom: 'Admin',
          actif: true
        }
      });
      console.log('[RESET] Admin créé: ' + email);
    }
  }
  await p.\$disconnect();
})().catch(e => { console.error('[RESET] Erreur:', e.message); process.exit(0); });
"
fi

echo "[3/3] Démarrage de l'application..."
exec node dist/app.js
