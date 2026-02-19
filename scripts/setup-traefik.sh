#!/bin/bash
# ============================================================
# setup-traefik.sh — Gateway partagé entre tous les projets
#
# À exécuter UNE SEULE FOIS sur le serveur.
# Installe Traefik comme reverse proxy global (SSL auto).
# Chaque projet reste 100% indépendant — Traefik ne fait
# qu'aiguiller le trafic selon le domaine.
#
# Usage : sudo bash setup-traefik.sh [email_letsencrypt]
# ============================================================

set -e

TRAEFIK_DIR="/opt/traefik"
EMAIL="${1:-admin@swipego.app}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   Traefik — Gateway partagé           ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

if [ "$EUID" -ne 0 ]; then echo "Exécuter en root (sudo)"; exit 1; fi

# Vérifier Docker
if ! command -v docker &> /dev/null; then
  warn "Installation Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi
log "Docker OK"

# ---- Créer le réseau partagé ----
section "Réseau partagé"
if docker network ls | grep -q "^.*\bproxy\b"; then
  log "Réseau 'proxy' déjà existant"
else
  docker network create proxy
  log "Réseau 'proxy' créé"
fi

# ---- Créer le dossier Traefik ----
section "Installation Traefik"
mkdir -p "$TRAEFIK_DIR"

# Fichier ACME (certificats SSL) — permissions strictes
touch "$TRAEFIK_DIR/acme.json"
chmod 600 "$TRAEFIK_DIR/acme.json"

# ---- Config Traefik ----
cat > "$TRAEFIK_DIR/traefik.yml" << TRAEFIK_CONF
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
    http3: {}

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
TRAEFIK_CONF

log "traefik.yml créé"

# ---- Docker Compose de Traefik ----
cat > "$TRAEFIK_DIR/docker-compose.yml" << 'COMPOSE'
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
COMPOSE

log "docker-compose.yml créé"

# ---- Démarrer Traefik ----
section "Démarrage Traefik"

# Arrêter l'ancien si présent
docker compose -f "$TRAEFIK_DIR/docker-compose.yml" down 2>/dev/null || true

docker compose -f "$TRAEFIK_DIR/docker-compose.yml" up -d
log "Traefik démarré"

# Ouvrir les ports firewall
if command -v ufw &> /dev/null; then
  ufw allow 80/tcp  2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  log "Ports 80/443 ouverts"
fi

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   ✅  Traefik prêt !                  ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  Traefik écoute sur ports 80/443."
echo "  Chaque projet doit :"
echo "    1. Joindre le réseau externe 'proxy'"
echo "    2. Avoir les labels Traefik dans docker-compose"
echo ""
echo "  Gestion : docker compose -f $TRAEFIK_DIR/docker-compose.yml [up|down|logs]"
echo ""
