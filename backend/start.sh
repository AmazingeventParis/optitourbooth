#!/bin/sh
set -e

echo "=== OptiTour Booth - Démarrage ==="

echo "[1/3] Synchronisation du schéma de base de données..."
prisma db push

echo "[2/3] Seed (upsert idempotent)..."
npx tsx prisma/seed.ts

echo "[3/3] Démarrage de l'application..."
exec node dist/app.js
