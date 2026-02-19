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

echo "[3/3] Démarrage de l'application..."
exec node dist/app.js
