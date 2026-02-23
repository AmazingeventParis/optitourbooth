# OptiTourBooth - Etat du projet

> Derniere mise a jour : 20 fevrier 2026

## Statut global : ~75-80% termine

Le coeur du projet est fonctionnel et deploye en production sur Coolify.

---

## Ce qui est FAIT et fonctionnel

### Backend
- **API Express + TypeScript** : 60+ endpoints, 10 controllers
- **Base de donnees** : PostgreSQL 16 + PostGIS, 15 modeles Prisma
- **Auth** : JWT + refresh tokens, roles multiples (admin/chauffeur/preparateur)
- **Temps reel** : Socket.io (positions chauffeurs, mises a jour statuts)
- **Cache** : Redis avec TTL et invalidation
- **Upload photos** : Cloudinary
- **Optimisation** : VROOM pour calcul de tournees optimales
- **Routing** : OSRM (directions, matrices)
- **Geocodage** : Nominatim
- **Auto-dispatch** : Attribution intelligente des points aux chauffeurs
- **Import Excel** : Parsing et import batch de points
- **Web Push** : Notifications navigateur via VAPID
- **Trafic** : TomTom (optionnel)

### Frontend Admin
- **Dashboard** : KPIs, tracking live des chauffeurs sur carte
- **Planning journalier** : Drag-and-drop, multi-tournees, calendrier, import Excel, optimisation VROOM
- **Tournees** : Liste, detail, gestion des points, incidents
- **Clients** : CRUD avec autocompletion adresse et geocodage
- **Produits** : Gestion types de photobooth + options
- **Utilisateurs** : Gestion multi-roles
- **Vehicules** : Gestion flotte avec consommation carburant
- **Preparations** : Workflow de preparation des machines (bornes)
- **Rapports** : Analytics avec graphiques (distances, durees, couts, incidents)

### Frontend Chauffeur (PWA)
- **Dashboard** : Stats semaine, livraison en cours, prompts PWA
- **Page point** : Details livraison, upload photo, capture signature, rapport incident
- **Page tournee** : Vue d'ensemble, liste points, carte navigation
- **Agenda** : Calendrier des tournees assignees
- **Profil** : Parametres, avatar
- **Onboarding** : Setup GPS, notifications, installation PWA

### Deploiement
- Docker multi-stage (Alpine) sur Coolify
- Auto-seed au premier deploiement
- Health checks configures
- Gestion des variables d'environnement

---

## Ce qui reste a faire

### Priorite haute

#### 1. Tests automatises
- Seulement 2 fichiers de test (dateUtils, phoneParser)
- Aucun test d'integration, E2E, ni composants frontend
- Critique pour la fiabilite en production

#### 2. Refactoring des gros fichiers
- `frontend/src/pages/DailyPlanningPage.tsx` : 4485 lignes
- `backend/src/controllers/tournee.controller.ts` : 2190 lignes
- `frontend/src/pages/TourneeDetailPage.tsx` : 1257 lignes

#### 3. Gestion des photos - incomplet
- Pas de galerie/vignettes dans l'UI chauffeur
- Pas de suppression de photos
- Pas de categorisation (avant/apres/incident/preuve)
- Photos non affichees cote admin pour review

#### 4. Exports & rapports
- Pas d'export Excel/CSV des tournees
- Pas de generation PDF (bons de livraison, rapports)
- Pas d'export itineraire pour GPS

### Priorite moyenne

#### 5. Notifications - lacunes
- Web Push ok
- Manque : notifications in-app, SMS, email
- Pas d'historique ni de regles personnalisables

#### 6. Optimisation mobile chauffeur
- Interface PWA existante mais peu testee sur vrais devices
- UX a ameliorer sur les grosses pages

#### 7. Planification avancee des tournees
- VROOM basique fonctionne
- Manque : multi-jours, contraintes capacite vehicule, competences chauffeur, equilibrage de charge, optimisation carburant

### Priorite basse

#### 8. Portail client
- Aucune interface client (suivi livraison, notification a la completion)

#### 9. Audit & conformite
- Pas de log d'audit des modifications
- Pas de workflow RGPD (export/suppression donnees)

#### 10. Gestion machines - incomplet
- CRUD basique ok
- Manque : planning maintenance, suivi defauts, historique location

---

## Problemes connus resolus

| Probleme | Solution |
|----------|----------|
| Timezone UTC (dates decalees en France) | `ensureDateUTC()` dans `backend/src/utils/dateUtils.ts` |
| Auto-dispatch spread operator | Retourner reference au lieu de copie |
| PWA blank screen | start_url "/" au lieu de "/chauffeur" |
| Coolify skip devDeps | `NODE_ENV=development` dans builder Docker |
| TypeScript TS2742 | `tsconfig.build.json` avec `declaration: false` |
| libssl.so.1.1 manquant | `apk add openssl` sur Alpine |
| Redis cache stale data | Cache desactive pour liste tournees |
| Roles migration | Passage de `role` (string) a `roles` (array) |

---

## Stats du codebase

| Metrique | Valeur |
|----------|--------|
| Controllers backend | 10 fichiers |
| Pages frontend | 15 pages |
| Services backend | 10 services |
| Services frontend | 12 services |
| Modeles base de donnees | 15 entites |
| Endpoints API | 60+ |
| Fichiers de test | 2 (utilitaires uniquement) |

---

## Notes de communication

- L'utilisateur principal communique en francais informel ("cc" = "coucou", salut decontracte)
- Repondre de maniere directe et informelle, pas de formalisme excessif
