# OptiTour Booth

Application de gestion de tournées pour livraison et ramassage de photobooths.

## Stack Technique

### Backend
- **Runtime**: Node.js 20 LTS
- **Framework**: Express.js
- **ORM**: Prisma
- **Base de données**: PostgreSQL + PostGIS
- **Cache**: Redis
- **Temps réel**: Socket.io
- **Auth**: JWT

### Frontend
- **Framework**: React 18 + Vite
- **UI**: Tailwind CSS + Headless UI
- **Carte**: Leaflet + React-Leaflet
- **State**: Zustand
- **Forms**: React Hook Form + Zod

### Services Externes (Gratuits)
- **Cartographie**: OpenStreetMap
- **Routing**: OSRM (self-hosted ou démo)
- **Geocoding**: Nominatim
- **Trafic**: TomTom (2500 req/jour gratuit)

## Prérequis

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Docker et Docker Compose

## Installation

### 1. Cloner et installer les dépendances

```bash
git clone https://github.com/Pixoupix/optitourbooth.git
cd optitourbooth
pnpm install
```

### 2. Configurer l'environnement

```bash
# Backend : copier et configurer le .env
cp backend/.env.example backend/.env
# Puis éditer backend/.env avec vos valeurs (voir ci-dessous)

# Frontend : copier et configurer le .env
cp frontend/.env.example frontend/.env
```

> **Note pour les collaborateurs** : Demandez les clés API et l'URL de la base de données
> à l'administrateur du projet (ne jamais les partager via GitHub).

### 3. Lancer les services Docker

```bash
# Démarrer PostgreSQL et Redis
pnpm docker:up

# Vérifier que les services sont up
docker-compose ps
```

### 4. Initialiser la base de données

```bash
# Générer le client Prisma
pnpm db:generate

# Exécuter les migrations
pnpm db:migrate

# (Optionnel) Peupler avec des données de test
pnpm db:seed
```

### 5. Lancer le projet en développement

```bash
# Lancer backend + frontend simultanément
pnpm dev

# Ou séparément :
pnpm dev:backend  # http://localhost:3000
pnpm dev:frontend # http://localhost:5173
```

## Comptes de démo

Après avoir exécuté le seed :

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Admin | admin@shootnbox.fr | admin123 |
| Chauffeur | chauffeur@shootnbox.fr | chauffeur123 |

## Scripts disponibles

```bash
# Développement
pnpm dev              # Lance tout
pnpm dev:backend      # Lance le backend seul
pnpm dev:frontend     # Lance le frontend seul

# Build
pnpm build            # Build tout
pnpm build:backend    # Build le backend
pnpm build:frontend   # Build le frontend

# Base de données
pnpm db:generate      # Génère le client Prisma
pnpm db:migrate       # Exécute les migrations
pnpm db:studio        # Ouvre Prisma Studio
pnpm db:seed          # Peuple la BDD
pnpm db:reset         # Reset complet de la BDD

# Docker
pnpm docker:up        # Lance les containers
pnpm docker:down      # Arrête les containers
pnpm docker:logs      # Affiche les logs

# Qualité
pnpm lint             # Lint tout le code
pnpm format           # Formate le code
```

## Structure du projet

```
OptiTourBooth/
├── backend/
│   ├── src/
│   │   ├── config/         # Configuration (DB, Redis, Socket)
│   │   ├── controllers/    # Contrôleurs API
│   │   ├── services/       # Logique métier
│   │   ├── middlewares/    # Auth, validation, erreurs
│   │   ├── routes/         # Définition des routes
│   │   ├── socket/         # Handlers WebSocket
│   │   ├── types/          # Types TypeScript
│   │   ├── utils/          # Utilitaires
│   │   └── app.ts          # Point d'entrée
│   └── prisma/
│       ├── schema.prisma   # Schéma de BDD
│       └── seed.ts         # Données initiales
│
├── frontend/
│   ├── src/
│   │   ├── components/     # Composants React
│   │   ├── pages/          # Pages de l'application
│   │   ├── hooks/          # Hooks personnalisés
│   │   ├── store/          # État global (Zustand)
│   │   ├── services/       # Appels API
│   │   ├── types/          # Types TypeScript
│   │   └── utils/          # Utilitaires
│   └── public/             # Assets statiques
│
├── docker/
│   └── postgres/
│       └── init.sql        # Script d'init PostgreSQL
│
├── docker-compose.yml      # Services Docker
├── package.json            # Monorepo config
└── pnpm-workspace.yaml     # Workspaces pnpm
```

## API Endpoints

### Authentification
- `POST /api/auth/login` - Connexion
- `POST /api/auth/refresh` - Rafraîchir le token
- `GET /api/auth/me` - Infos utilisateur courant

### Utilisateurs (Admin)
- `GET /api/users` - Liste des utilisateurs
- `POST /api/users` - Créer un utilisateur
- `GET /api/users/:id` - Détails utilisateur
- `PUT /api/users/:id` - Modifier un utilisateur
- `DELETE /api/users/:id` - Supprimer un utilisateur

### Clients
- `GET /api/clients` - Liste des clients
- `POST /api/clients` - Créer un client
- `GET /api/clients/:id` - Détails client
- `PUT /api/clients/:id` - Modifier un client
- `DELETE /api/clients/:id` - Supprimer un client

### Tournées
- `GET /api/tournees` - Liste des tournées
- `POST /api/tournees` - Créer une tournée
- `GET /api/tournees/:id` - Détails tournée
- `PUT /api/tournees/:id` - Modifier une tournée
- `POST /api/tournees/:id/optimize` - Optimiser l'ordre

### Points
- `GET /api/points` - Liste des points
- `POST /api/points` - Créer un point
- `PUT /api/points/:id` - Modifier un point
- `PUT /api/points/:id/status` - Changer le statut

## Phases de développement

- [x] **Phase 1** - Infrastructure & Setup
- [ ] **Phase 2** - Backend Auth & Entités
- [ ] **Phase 3** - Backend Tournées & Optimisation
- [ ] **Phase 4** - Frontend Admin Base
- [ ] **Phase 5** - Frontend Carte & Planning
- [ ] **Phase 6** - Temps Réel (WebSocket)
- [ ] **Phase 7** - Espace Chauffeur Web
- [ ] **Phase 8** - Fonctionnalités Avancées
- [ ] **Phase 9** - Polish & Production

## Licence

Propriétaire - Vincent Shootnbox
