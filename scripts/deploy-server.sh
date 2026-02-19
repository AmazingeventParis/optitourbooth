#!/bin/bash
# ============================================================
# deploy-server.sh — OptiTour Booth
# Déploiement one-command sur serveur dédié Ubuntu
#
# Usage :
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/scripts/deploy-server.sh | bash
#   OU
#   chmod +x scripts/deploy-server.sh && sudo ./scripts/deploy-server.sh
# ============================================================

set -e

INSTALL_DIR="/opt/optitourbooth"
REPO_URL="https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git"  # À modifier
COMPOSE_FILE="docker-compose.production.yml"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
error()   { echo -e "${RED}❌ $1${NC}"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   OptiTour Booth — Déploiement serveur   ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ---- 1. Vérifier les droits ----
section "Vérification des droits"
if [ "$EUID" -ne 0 ]; then
  error "Ce script doit être exécuté en root (sudo ./deploy-server.sh)"
fi
log "Droits root OK"

# ---- 2. Mise à jour système ----
section "Mise à jour du système"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg lsb-release
log "Système à jour"

# ---- 3. Installer Docker ----
section "Installation Docker"
if command -v docker &> /dev/null; then
  log "Docker déjà installé : $(docker --version)"
else
  warn "Installation de Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "Docker installé : $(docker --version)"
fi

# Docker Compose
if ! docker compose version &> /dev/null; then
  warn "Installation Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin
fi
log "Docker Compose : $(docker compose version)"

# ---- 4. Cloner / mettre à jour le repo ----
section "Code source"
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Repo existant, mise à jour..."
  cd "$INSTALL_DIR"
  git pull origin master
  log "Code mis à jour"
else
  warn "Clonage du repo dans $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  log "Repo cloné"
fi

# ---- 5. Configurer le .env ----
section "Configuration .env"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.production.example" "$INSTALL_DIR/.env"
  log "Fichier .env créé depuis le template"

  # Demander le domaine
  echo ""
  read -p "🌐 Domaine du site (ex: optitourbooth.swipego.app) : " DOMAIN
  if [ -z "$DOMAIN" ]; then
    DOMAIN="optitourbooth.swipego.app"
    warn "Domaine par défaut utilisé : $DOMAIN"
  fi
  sed -i "s/DOMAIN=optitourbooth.swipego.app/DOMAIN=$DOMAIN/" "$INSTALL_DIR/.env"

  # Générer des secrets aléatoires
  JWT_SECRET=$(openssl rand -hex 64)
  JWT_REFRESH=$(openssl rand -hex 64)
  DB_PASS=$(openssl rand -hex 32)

  sed -i "s/CHANGEZ_MOI_PASSWORD_SECURISE/$DB_PASS/" "$INSTALL_DIR/.env"
  sed -i "s/CHANGEZ_MOI_SECRET_LONG_ET_ALEATOIRE_256_BITS/$JWT_SECRET/" "$INSTALL_DIR/.env"
  sed -i "s/CHANGEZ_MOI_REFRESH_SECRET_DIFFERENT_DU_PRECEDENT/$JWT_REFRESH/" "$INSTALL_DIR/.env"

  log "Secrets générés automatiquement"
  warn "Éditez $INSTALL_DIR/.env pour ajouter vos clés API (TomTom, ORS, VAPID)"
else
  log ".env existant, conservé"
fi

# Charger le .env
set -a
source "$INSTALL_DIR/.env"
set +a

# ---- 6. Ouvrir les ports firewall ----
section "Firewall"
if command -v ufw &> /dev/null; then
  ufw allow 80/tcp  2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  log "Ports 80/443 ouverts"
fi

# ---- 7. Build et démarrage ----
section "Build Docker"
cd "$INSTALL_DIR"

warn "Build des images (peut prendre 5-10 min au premier lancement)..."
docker compose -f "$COMPOSE_FILE" build --no-cache

log "Images buildées"

section "Démarrage des services"
docker compose -f "$COMPOSE_FILE" up -d

warn "Attente démarrage PostgreSQL..."
sleep 10

# ---- 8. Migrations Prisma ----
section "Migrations base de données"
docker compose -f "$COMPOSE_FILE" exec -T backend sh -c "cd /app/backend && npx prisma migrate deploy" || \
docker compose -f "$COMPOSE_FILE" exec -T backend sh -c "cd /app/backend && npx prisma db push --skip-generate"
log "Base de données initialisée"

# ---- 9. Vérification ----
section "Vérification des services"
sleep 5
docker compose -f "$COMPOSE_FILE" ps

# ---- Résumé ----
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ✅  Déploiement terminé !              ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  🌐 Site    : https://${DOMAIN:-optitourbooth.swipego.app}"
echo "  🔧 Config  : $INSTALL_DIR/.env"
echo ""
echo "  Commandes utiles :"
echo "  • Logs en direct : docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f"
echo "  • Logs backend   : docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f backend"
echo "  • Redémarrer     : docker compose -f $INSTALL_DIR/$COMPOSE_FILE restart"
echo "  • Mettre à jour  : cd $INSTALL_DIR && git pull && docker compose -f $COMPOSE_FILE build --no-cache && docker compose -f $COMPOSE_FILE up -d"
echo ""
echo "  ⚠️  N'oubliez pas de configurer votre DNS :"
echo "  ${DOMAIN:-optitourbooth.swipego.app} → $(curl -s ifconfig.me 2>/dev/null || echo 'votre_ip_serveur')"
echo ""
