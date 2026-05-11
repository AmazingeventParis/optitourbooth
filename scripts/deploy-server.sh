#!/bin/bash
# ============================================================
# deploy-server.sh — OptiTour Booth
# Déploiement sur serveur dédié Ubuntu
#
# Usage : sudo bash deploy-server.sh
# ============================================================

set -e

INSTALL_DIR="/opt/optitourbooth"
REPO_URL="https://github.com/Pixoupix/optitourbooth.git"
COMPOSE_FILE="docker-compose.production.yml"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
error()   { echo -e "${RED}❌ $1${NC}"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   OptiTour Booth — Déploiement serveur   ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

[ "$EUID" -ne 0 ] && error "Exécuter en root : sudo bash deploy-server.sh"

# ---- 1. Dépendances système ----
section "Dépendances système"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates openssl
log "Dépendances OK"

# ---- 2. Docker ----
section "Docker"
if ! command -v docker &> /dev/null; then
  warn "Installation Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi
log "Docker : $(docker --version)"
if ! docker compose version &> /dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi
log "Docker Compose : $(docker compose version)"

# ---- 3. Traefik (gateway partagé) ----
section "Traefik (gateway partagé)"
if docker ps --format '{{.Names}}' | grep -q "^traefik$"; then
  log "Traefik déjà en cours d'exécution"
else
  warn "Traefik non détecté. Installation..."

  # Récupérer l'email pour Let's Encrypt
  read -p "📧 Email pour les certificats SSL (Let's Encrypt) : " LE_EMAIL
  LE_EMAIL="${LE_EMAIL:-admin@swipego.app}"

  # Télécharger et exécuter le script Traefik depuis le repo OptiTour
  TRAEFIK_SCRIPT="$INSTALL_DIR/scripts/setup-traefik.sh"
  if [ -f "$TRAEFIK_SCRIPT" ]; then
    bash "$TRAEFIK_SCRIPT" "$LE_EMAIL"
  else
    # Si le repo n'est pas encore cloné, utiliser une version inline
    bash <(cat << 'INLINE_TRAEFIK'
#!/bin/bash
set -e
TRAEFIK_DIR="/opt/traefik"
EMAIL="${1:-admin@swipego.app}"
mkdir -p "$TRAEFIK_DIR"
touch "$TRAEFIK_DIR/acme.json" && chmod 600 "$TRAEFIK_DIR/acme.json"
docker network ls | grep -q "\bproxy\b" || docker network create proxy
cat > "$TRAEFIK_DIR/traefik.yml" << TCONF
global:
  checkNewVersion: false
  sendAnonymousUsage: false
api:
  dashboard: false
log:
  level: WARN
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"
providers:
  docker:
    exposedByDefault: false
    network: proxy
certificatesResolvers:
  letsencrypt:
    acme:
      email: ${EMAIL}
      storage: /acme.json
      httpChallenge:
        entryPoint: web
TCONF
cat > "$TRAEFIK_DIR/docker-compose.yml" << 'TCOMPOSE'
version: '3.8'
services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/etc/traefik/traefik.yml:ro
      - ./acme.json:/acme.json
    networks:
      - proxy
networks:
  proxy:
    external: true
TCOMPOSE
docker compose -f "$TRAEFIK_DIR/docker-compose.yml" up -d
echo "✅ Traefik démarré"
INLINE_TRAEFIK
) "$LE_EMAIL"
  fi

  # Ouvrir les ports
  command -v ufw &>/dev/null && { ufw allow 80/tcp 2>/dev/null; ufw allow 443/tcp 2>/dev/null; } || true
  log "Traefik installé et démarré"
fi

# ---- 4. Code source ----
section "Code source"
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Mise à jour du code..."
  git -C "$INSTALL_DIR" pull origin master
  log "Code mis à jour"
else
  warn "Clonage dans $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  log "Repo cloné"
fi

# ---- 5. Configuration .env ----
section "Configuration .env"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.production.example" "$INSTALL_DIR/.env"

  echo ""
  read -p "🌐 Domaine OptiTour (ex: optitourbooth.swipego.app) : " DOMAIN
  DOMAIN="${DOMAIN:-optitourbooth.swipego.app}"

  # Secrets auto-générés
  DB_PASS=$(openssl rand -hex 32)
  JWT_S=$(openssl rand -hex 64)
  JWT_R=$(openssl rand -hex 64)

  sed -i "s/DOMAIN=optitourbooth.swipego.app/DOMAIN=$DOMAIN/"                                 "$INSTALL_DIR/.env"
  sed -i "s/CHANGEZ_MOI_PASSWORD_SECURISE/$DB_PASS/"                                           "$INSTALL_DIR/.env"
  sed -i "s/CHANGEZ_MOI_SECRET_LONG_ET_ALEATOIRE_256_BITS/$JWT_S/"                             "$INSTALL_DIR/.env"
  sed -i "s/CHANGEZ_MOI_REFRESH_SECRET_DIFFERENT_DU_PRECEDENT/$JWT_R/"                        "$INSTALL_DIR/.env"

  log ".env créé avec secrets générés automatiquement"
  warn "Ajoutez vos clés API dans $INSTALL_DIR/.env (TomTom, ORS, VAPID...)"
else
  log ".env existant conservé"
fi

# Charger les variables
set -a; source "$INSTALL_DIR/.env"; set +a

# ---- 6. Build et démarrage ----
section "Build Docker"
cd "$INSTALL_DIR"
warn "Build en cours (5-10 min au premier lancement)..."
docker compose -f "$COMPOSE_FILE" build --no-cache
log "Build terminé"

section "Démarrage des services"
docker compose -f "$COMPOSE_FILE" up -d
warn "Attente démarrage PostgreSQL (15s)..."
sleep 15

# ---- 7. Migrations ----
section "Migrations base de données"
docker compose -f "$COMPOSE_FILE" exec -T backend sh -c \
  "cd /app/backend && npx prisma migrate deploy 2>/dev/null || npx prisma db push --skip-generate"
log "Base de données prête"

# ---- 8. Statut ----
section "Statut des services"
docker compose -f "$COMPOSE_FILE" ps

# ---- Résumé ----
DOMAIN_DISPLAY="${DOMAIN:-optitourbooth.swipego.app}"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "votre_ip")

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ✅  OptiTour déployé avec succès !     ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  🌐 URL      : https://$DOMAIN_DISPLAY"
echo "  🔧 Config   : $INSTALL_DIR/.env"
echo "  📁 Uploads  : volume Docker optitourbooth_uploads_data"
echo ""
echo "  ⚠️  Configuration DNS requise :"
echo "  $DOMAIN_DISPLAY → $SERVER_IP"
echo ""
echo "  ━━━ Commandes utiles ━━━"
echo "  Logs       : docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f"
echo "  Logs API   : docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f backend"
echo "  Redémarrer : docker compose -f $INSTALL_DIR/$COMPOSE_FILE restart"
echo "  Arrêter    : docker compose -f $INSTALL_DIR/$COMPOSE_FILE down"
echo ""
echo "  ━━━ Mise à jour ━━━"
echo "  cd $INSTALL_DIR && git pull origin master"
echo "  docker compose -f $COMPOSE_FILE build --no-cache backend frontend"
echo "  docker compose -f $COMPOSE_FILE up -d"
echo ""
