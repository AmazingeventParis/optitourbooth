# OptiTourBooth - Etat du Projet

## Vue d'ensemble
Systeme de gestion de flotte et optimisation de tournees pour livraison/ramassage de photobooths (Shootnbox).

- **API** : https://optitourbooth-api.swipego.app (UUID: `kgsgo448os84csgso4o88cwo`)
- **Web** : https://optitourbooth.swipego.app (UUID: `hooooowo888gwocoksc8c4gk`)
- **Repo API** : https://github.com/AmazingeventParis/optitourbooth
- **Repo Web** : https://github.com/Pixoupix/optitourbooth
- **Status** : Deploye et fonctionnel

## Stack

### Backend
- Node.js 20 + Express + TypeScript
- Prisma 5 + PostgreSQL 16 + PostGIS
- Redis 7 (cache), Socket.io 4.7 (temps reel)
- JWT (access + refresh tokens)
- Cloudinary + Sharp (images), PDFKit (PDF)
- Zod (validation), Multer (upload), XLSX (import Excel)
- Web-push (VAPID)

### Frontend
- React 18 + Vite 5 + TypeScript + Tailwind 3
- Zustand (state), React Query 5 (data fetching)
- Leaflet + React-Leaflet (cartes)
- dnd-kit (drag & drop), Recharts (graphiques)
- React Hook Form + Zod
- React Router v6, PWA installable

### Routing/Optimisation
- OSRM (calcul routes)
- VROOM (optimisation avec fenetres horaires)
- Nominatim (geocodage)
- TomTom (trafic predictif, optionnel)

## Roles
- **admin** : Dashboard complet, planning, rapports
- **chauffeur** : Interface mobile, GPS, signatures
- **preparateur** : Gestion equipement

## DB (modeles principaux)
- User (roles: admin/chauffeur/preparateur)
- Vehicule (immatriculation, capacite, conso)
- Client (adresse + lat/lng, contact, acces)
- Produit (Vegas/Smakk/Ring + options, durees install)
- Tournee (statut: brouillon/planifiee/en_cours/terminee/annulee)
- Point (livraison/ramassage, fenetres horaires, signatures, photos)
- Machine (inventaire equipement, defauts)
- Preparation (lifecycle: disponible → prete → en_cours → archivee)
- Incident (types: client_absent, adresse_incorrecte, etc.)
- Position (GPS tracking, indexe par chauffeur+timestamp)
- PushSubscription, RefreshToken

## Structure
```
backend/
  src/
    controllers/  - auth, user, client, produit, tournee, gps, vehicule, machine, preparation
    services/     - auth, osrm, vroom, tomtom, geocoding, notification, import, autodispatch
    routes/       - REST routes
    config/       - database, redis, socket, cloudinary
    middlewares/  - auth JWT, validation Zod, error handler
  prisma/schema.prisma + seed.ts

frontend/
  src/
    pages/        - Dashboard, Users, Vehicules, Clients, Produits, Tournees, Planning, Rapports
    pages/chauffeur/ - ChauffeurDashboard, ChauffeurTournee, ChauffeurPoint, ChauffeurAgenda
    components/   - layout, map (RouteMap, MultiTourneeMap), tournee, ui
    hooks/        - queries (React Query), useGPSTracking, useInstallPWA
    store/        - authStore, chauffeurStore, socketStore (Zustand)
    services/     - api, auth, users, clients, tournees, gps, machines, preparations, socket
```

## Socket.io (temps reel)
- position:update (chauffeur → serveur → admins)
- point:status-change, incident:report
- tournee:update, notification
- Rooms: user:{id}, admins, chauffeurs, tournee:{id}

## Fonctionnalites cles
- Import Excel (clients + points + auto-geocodage)
- Auto-dispatch (repartition equitable des points)
- Optimisation VROOM (fenetres horaires + durees service)
- GPS temps reel avec Socket.io
- PWA installable (Android + iOS)
- Multi-phone parser
- Stats separees: temps trajet vs temps sur site
- Gestion equipement (lifecycle photobooth)
- Incidents (photo + description)
- Web Push notifications
- Admin impersonation (tester interface chauffeur)
- Auto-terminaison tournees passees (CRON 5min)
- Redis cache (routes 15min, chauffeurs 1h)

## Comptes test
- Admin: vincent.pixerelle@gmail.com / testtesT1!
- Admin: admin@shootnbox.fr / admin123
- Chauffeur: chauffeur@shootnbox.fr / chauffeur123

## Env vars (backend)
- DATABASE_URL, NODE_ENV, PORT
- JWT_SECRET, JWT_REFRESH_SECRET
- CORS_ORIGIN (URL frontend)
- REDIS_URL, OSRM_URL, NOMINATIM_URL, VROOM_URL
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
- TOMTOM_API_KEY (optionnel)

## Env vars (frontend)
- VITE_API_URL, VITE_SOCKET_URL

## Problemes resolus
- Timezone UTC: new Date("YYYY-MM-DD") en France donne jour precedent → ensureDateUTC()
- Auto-dispatch: spread operator copiait objet → retourner reference
- PWA blank: start_url etait "/chauffeur" → change en "/"
- Coolify NODE_ENV: force NODE_ENV=development dans builder
- TypeScript TS2742: tsconfig.build.json avec declaration: false
- libssl.so.1.1: Alpine 3.18+ → apk add openssl

## Deploy
```bash
# API (repo AmazingeventParis)
git push origin master
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=kgsgo448os84csgso4o88cwo&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"

# Web (repo Pixoupix - push separe)
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=hooooowo888gwocoksc8c4gk&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"
```
