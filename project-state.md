# OptiTourBooth - Etat du Projet (mise a jour 2026-02-20)

## Infos
- **Backend** : https://optitourbooth-api.swipego.app (UUID: `kgsgo448os84csgso4o88cwo`)
- **Frontend** : https://optitourbooth.swipego.app (UUID: `hooooowo888gwocoksc8c4gk`)
- **PostgreSQL** : UUID `bswkc044ws8ccg4sswg8w8ss`
- **Redis** : UUID `soo88cgkwsowkkoc8g40k8co`
- **Repos** : AmazingeventParis/optitourbooth (backend) + Pixoupix/optitourbooth (frontend)
- **Type** : Application de gestion de tournees et logistique pour Shootnbox

## Stack
- **Backend** : Node.js + Express + TypeScript + Prisma 5 + PostgreSQL
- **Frontend** : React + Vite + TypeScript + Tailwind
- **Deploy** : Docker (Dockerfiles separes backend/frontend) + Coolify
- **Optimisation** : VROOM/OpenRouteService + TomTom (trafic predictif) + OSRM
- **Cache** : Redis (cache tournees 15min, chauffeurs 1h)

## Structure
```
backend/          → API Express + Prisma
  Dockerfile      → Multi-stage, standalone (pas de workspace)
  start.sh        → prisma db push + seed si vide + node dist/app.js
  tsconfig.build.json → declaration: false (fix TS2742)
frontend/         → React SPA + Vite
  Dockerfile      → Vite build → nginx
  nginx.conf      → SPA avec gzip
```

## Comptes
- Admin : vincent.pixerelle@gmail.com / testtesT1!
- Admin test : admin@shootnbox.fr / admin123
- Chauffeur test : chauffeur@shootnbox.fr / chauffeur123

## Fonctionnalites
- Import Excel (clients, points, tournees) avec creation auto clients + geocodage
- Auto-dispatch : repartition equitable des points entre chauffeurs
- Optimisation VROOM (creneaux horaires, durees installation, temps trajet)
- TomTom trafic predictif (heure de pointe, jour de semaine)
- Parser telephone intelligent (multi-numeros, composant PhoneNumbers)
- Suivi GPS temps reel (Socket.io) + mode impersonation admin
- PWA installable (onboarding chauffeur, permissions GPS/notifications)
- Page rapports avec stats + graphiques
- Page preparations (bornes) avec filtres, recherche, archive
- Cache Redis (tournees 15min, chauffeurs 1h)
- Auto-terminaison tournees passees
- Separation temps de trajet vs temps total

## Problemes resolus importants
- **Timezone UTC** : `new Date("YYYY-MM-DD")` en France (UTC+1) donne la veille en UTC → `ensureDateUTC()` force toujours UTC
- **Auto-dispatch** : spread operator copiait l'objet au lieu de modifier la reference → retourner reference originale
- **PWA ecran blanc** : start_url "/chauffeur" → changer en "/"
- **Coolify NODE_ENV** : injecte production → `NODE_ENV=development pnpm install` dans builder
- **TS2742** : type non portable avec pnpm standalone → `declaration: false`
- **Prisma 7.x** : `npx prisma generate` telecharge v7 → `npm install -g prisma@5`
- **libssl.so.1.1** : manquant sur Alpine → `apk add openssl`
- **Extension unaccent** : `previewFeatures = ["postgresqlExtensions"]` + `extensions = [unaccent]`

## Optimisations performance (Session 14 fev)
| Metrique | Avant | Apres | Gain |
|----------|-------|-------|------|
| RapportsPage | 5s | 250ms | 20x |
| DailyPlanning | 4.5s | 1.8s | 2.5x |
| DailyPlanning cache | 4.5s | 300ms | 15x |
| Upload photo 10MB | 6s | 1s | 6x |
| Liste tournees cache | 800ms | 40ms | 20x |

## TODO
- Service Worker cache-first (mode offline)
- Bundle optimization (lazy-load Leaflet)
- Differencier davantage les roles admin/chauffeur/preparateur
