#!/bin/bash
# ============================================================
# migrate-focusracer-traefik.sh
#
# Migre Focus Racer de son propre Caddy vers Traefik.
# À exécuter APRÈS setup-traefik.sh.
#
# Ce script modifie le docker-compose.production.yml de Focus Racer
# pour utiliser Traefik au lieu de Caddy.
#
# Usage : sudo bash migrate-focusracer-traefik.sh
# ============================================================

set -e

FR_DIR="/opt/focusracer"
FR_COMPOSE="$FR_DIR/docker-compose.production.yml"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
error()   { echo -e "${RED}❌ $1${NC}"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

echo ""
echo "  ╔═════════════════════════════════════════════╗"
echo "  ║   Focus Racer → Migration vers Traefik      ║"
echo "  ╚═════════════════════════════════════════════╝"
echo ""

[ "$EUID" -ne 0 ] && error "Exécuter en root"

# Vérifier que Traefik tourne
if ! docker ps --format '{{.Names}}' | grep -q "^traefik$"; then
  error "Traefik n'est pas en cours d'exécution. Lancez d'abord : sudo bash setup-traefik.sh"
fi
log "Traefik en cours d'exécution"

# Vérifier que Focus Racer est installé
[ ! -d "$FR_DIR" ] && error "Focus Racer non trouvé dans $FR_DIR"
[ ! -f "$FR_COMPOSE" ] && error "docker-compose.production.yml non trouvé dans $FR_DIR"

# Charger .env de Focus Racer
[ -f "$FR_DIR/.env" ] && { set -a; source "$FR_DIR/.env"; set +a; }
FR_DOMAIN="${DOMAIN:-focusracer.swipego.app}"

section "Arrêt de Focus Racer"
cd "$FR_DIR"
docker compose -f docker-compose.production.yml down
log "Focus Racer arrêté"

section "Sauvegarde docker-compose.production.yml"
cp "$FR_COMPOSE" "${FR_COMPOSE}.bak.$(date +%Y%m%d_%H%M%S)"
log "Sauvegarde créée"

section "Mise à jour docker-compose.production.yml"

# Ajouter le réseau proxy et les labels Traefik au service 'app'
# Note : ceci suppose que le service Next.js s'appelle 'app' et écoute sur le port 3000
# Adapter si nécessaire.

python3 << PYTHON_PATCH
import re

with open("$FR_COMPOSE", "r") as f:
    content = f.read()

# Supprimer le service caddy
content = re.sub(r'\n  # .*?[Cc]addy.*?\n  caddy:.*?(?=\n  [a-z]|\nvolumes:|\nnetworks:)', '', content, flags=re.DOTALL)

# Supprimer les volumes caddy
content = re.sub(r'\n  caddy_data:.*?\n', '\n', content)
content = re.sub(r'\n  caddy_config:.*?\n', '\n', content)
content = re.sub(r'\n  caddy_logs:.*?\n', '\n', content)
content = re.sub(r'\n    caddy_data:.*\n', '\n', content)
content = re.sub(r'\n    caddy_config:.*\n', '\n', content)
content = re.sub(r'\n    caddy_logs:.*\n', '\n', content)

# Ajouter le réseau proxy dans la section networks du bas
if "  proxy:" not in content:
    content = content.rstrip() + """

  proxy:
    name: proxy
    external: true
"""

with open("$FR_COMPOSE", "w") as f:
    f.write(content)

print("✅ Caddy supprimé du compose")
PYTHON_PATCH

# Ajouter manuellement les labels et le réseau proxy au service app
# C'est plus sûr de le faire manuellement en éditant le fichier
echo ""
warn "Action manuelle requise :"
echo ""
echo "  Éditez : $FR_COMPOSE"
echo ""
echo "  1. Trouvez le service 'app' (Next.js)"
echo "  2. Ajoutez ces lignes dans sa section :"
echo ""
echo "     networks:"
echo "       - app_network        # ou le nom de votre réseau interne"
echo "       - proxy"
echo "     labels:"
echo "       - \"traefik.enable=true\""
echo "       - \"traefik.http.routers.focusracer.rule=Host(\`$FR_DOMAIN\`)\""
echo "       - \"traefik.http.routers.focusracer.entrypoints=websecure\""
echo "       - \"traefik.http.routers.focusracer.tls.certresolver=letsencrypt\""
echo "       - \"traefik.http.services.focusracer.loadbalancer.server.port=3000\""
echo ""
echo "  3. Ajoutez dans la section 'networks' globale :"
echo "       proxy:"
echo "         name: proxy"
echo "         external: true"
echo ""
read -p "Appuyez sur Entrée quand le fichier est modifié..."

section "Redémarrage Focus Racer"
cd "$FR_DIR"
docker compose -f docker-compose.production.yml up -d
log "Focus Racer redémarré"

sleep 5
docker compose -f docker-compose.production.yml ps

echo ""
echo "  ✅ Focus Racer migré vers Traefik"
echo "  🌐 https://$FR_DOMAIN"
echo ""
