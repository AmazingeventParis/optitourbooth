# Historique des sessions Claude - OptiTourBooth

## Session du 4 février 2026

### Problèmes résolus

#### 1. Optimisation de tournées non fonctionnelle
**Problème** : Le système d'optimisation de tournées ne fonctionnait pas correctement.

**Solution** : Intégration de VROOM via OpenRouteService API
- Création du service `backend/src/services/vroom.service.ts`
- Support des créneaux horaires (time windows)
- Support des durées d'installation/désinstallation (service times)
- Support des temps de trajet entre points (via OSRM)
- Configuration via `ORS_API_KEY` dans `.env`
- Fallback automatique sur OSRM si VROOM échoue

**Fichiers modifiés** :
- `backend/src/services/vroom.service.ts` (nouveau)
- `backend/src/services/optimization.service.ts`
- `backend/src/config/index.ts`
- `backend/.env`
- `docker-compose.yml`

---

#### 2. Auto-dispatch : tous les points allaient au même chauffeur
**Problème** : Lors de l'import d'un fichier Excel, tous les points étaient assignés à un seul chauffeur au lieu d'être répartis équitablement.

**Cause** : Le code utilisait le spread operator `{ ...bestCandidate }` qui créait une copie de l'objet. Quand on incrémentait `currentPoints++`, on modifiait la copie au lieu de l'objet original dans le tableau.

**Solution** : Retourner la référence originale de l'objet pour que les mises à jour persistent entre les itérations.

**Fichier modifié** : `backend/src/services/autodispatch.service.ts`

```typescript
// AVANT (bug)
return { ...bestCandidate, reason };

// APRÈS (fix)
return { candidate: bestCandidate, reason };
```

---

#### 3. Optimisation bloquée pour les tournées en brouillon
**Problème** : L'optimisation VROOM ne s'exécutait pas après l'auto-dispatch car elle n'acceptait que les tournées avec statut `planifiee`.

**Solution** : Modifier la condition pour accepter aussi les tournées `brouillon`.

**Fichier modifié** : `backend/src/services/optimization.service.ts`

```typescript
// AVANT
if (tournee.statut !== 'planifiee') { ... }

// APRÈS
if (!['brouillon', 'planifiee'].includes(tournee.statut)) { ... }
```

---

#### 4. Clients non existants bloquent l'import
**Problème** : Si un client dans le fichier Excel n'existait pas dans la base de données, les points n'étaient pas importés.

**Solution** : Création automatique des nouveaux clients lors de l'import avec :
- Géocodage automatique de l'adresse (Nominatim)
- Récupération des coordonnées GPS
- Sauvegarde des informations de contact

**Fichier modifié** : `backend/src/services/import.service.ts`

---

#### 5. Ajout du champ "Société" pour les clients
**Demande** : Pouvoir rechercher un client par son nom de société.

**Solution** :
- Ajout du champ `societe` au modèle Client (Prisma)
- Mise à jour de la recherche pour chercher par nom OU société
- Mise à jour de l'autocomplete
- Mise à jour des validateurs
- Mise à jour du service d'import

**Fichiers modifiés** :
- `backend/prisma/schema.prisma`
- `backend/src/controllers/client.controller.ts`
- `backend/src/services/import.service.ts`
- `backend/src/validators/client.validator.ts`

---

### Format Excel pour l'import

| Colonne | Description | Obligatoire |
|---------|-------------|-------------|
| CLIENT | Nom du client/contact | Oui |
| SOCIETE | Nom de la société | Non |
| ADRESSE | Adresse complète | Oui (pour nouveaux clients) |
| TYPE | livraison / ramassage / livraison_ramassage | Non (défaut: livraison) |
| DEBUT CRENEAU | Heure de début (HH:MM) | Non |
| FIN CRENEAU | Heure de fin (HH:MM) | Non |
| CONTACT | Nom du contact sur place | Non |
| TELEPHONE | Téléphone du contact | Non |
| PRODUIT | Nom du produit | Non |
| INFOS | Notes internes | Non |

---

### Variables d'environnement ajoutées

```env
# VROOM - Optimisation de tournées
VROOM_URL=          # URL VROOM local (optionnel)
VROOM_ENABLED=false # Activer VROOM local

# OpenRouteService API (alternative cloud à VROOM)
ORS_API_KEY=your_api_key_here
```

---

### Commits de cette session

1. `fix: auto-dispatch now properly distributes points across tournées`
2. `fix: allow optimization for draft tournées + add logging`
3. `feat: auto-create clients during Excel import`
4. `feat: add societe (company) field to clients`

---

### Architecture de l'optimisation

```
Import Excel
    │
    ▼
parseExcel() ─── Client existe? ─── Non ──► Créer client + géocoder
    │                   │
    │                  Oui
    │                   │
    ▼                   ▼
Auto-dispatch ──► Répartir équitablement entre tournées
    │
    ▼
Pour chaque tournée modifiée:
    │
    ▼
VROOM Optimization (si ORS_API_KEY configuré)
    │
    ├── Time windows (créneaux horaires)
    ├── Service times (durées installation)
    └── Travel times (temps de trajet OSRM)
    │
    ▼
Mise à jour ordre des points + heures d'arrivée estimées
```

---

---

#### 6. Intégration TomTom pour le trafic prédictif
**Demande** : Prendre en compte le trafic (embouteillages, heures de pointe) dans le calcul des temps de trajet.

**Solution** : Intégration de l'API TomTom (gratuit jusqu'à 2500 req/jour)
- Trafic prédictif basé sur le jour de la semaine
- Trafic prédictif basé sur l'heure de passage
- Calcul des temps de trajet réalistes
- Fallback sur OSRM si TomTom non configuré

**Fichiers créés/modifiés** :
- `backend/src/services/tomtom.service.ts` (nouveau)
- `backend/src/services/optimization.service.ts`

**Configuration** :
```env
TOMTOM_API_KEY=your_api_key_here
```

---

#### 7. Suppression de la barre de header
**Demande** : Supprimer la barre en haut (recherche, cloche, menu utilisateur) et déplacer la déconnexion dans la sidebar.

**Fichiers modifiés** :
- `frontend/src/components/layout/Layout.tsx`
- `frontend/src/components/layout/Sidebar.tsx`

---

---

## Session du 11 février 2026

### Problèmes résolus

#### 8. Duplication du type de produit dans le dashboard
**Problème** : Les produits étaient affichés 2 fois dans les cartes de tournée du dashboard :
- Une fois sous le nom du client (pour chaque point)
- Une fois en bas de la carte dans des cartouches grisées (résumé global)

**Solution** : Suppression du résumé global en bas et conservation de l'affichage par point.

**Fichiers modifiés** :
- `frontend/src/pages/DashboardPage.tsx`

---

#### 9. Onboarding PWA pour les chauffeurs
**Problème** : Les chauffeurs n'activaient pas les permissions GPS et notifications car :
- Aucun processus guidé pour demander les permissions
- Les bannières étaient faciles à ignorer
- Pas d'explication sur l'importance des permissions

**Solution** : Création d'un système d'onboarding complet pour les chauffeurs
- Page d'onboarding en 4 étapes au premier lancement
- Demande explicite du GPS avec explications claires
- Demande explicite des notifications push
- Proposition d'installation de la PWA
- Blocage de l'accès tant que le GPS n'est pas autorisé
- Page d'aide avec instructions détaillées par navigateur/OS
- Bannière d'alerte si permissions refusées
- Stockage local pour ne montrer qu'une fois

**Fichiers créés** :
- `frontend/src/pages/ChauffeurOnboardingPage.tsx` (page d'onboarding)
- `frontend/src/pages/ChauffeurPermissionsHelp.tsx` (page d'aide)

**Fichiers modifiés** :
- `frontend/src/App.tsx` (nouvelles routes)
- `frontend/src/components/layout/ChauffeurLayout.tsx` (redirection onboarding + bannière aide)
- `frontend/public/manifest.json` (amélioration PWA)

**Fonctionnalités** :
- **Étape 1** : Écran de bienvenue
- **Étape 2** : Demande permission GPS avec explications
- **Étape 3** : Demande permission notifications avec explications
- **Étape 4** : Installation PWA (si disponible)
- **Aide** : Instructions détaillées pour Android/iOS, Chrome/Safari
- **Bannière** : Alerte visible si GPS ou notifications désactivés

**Améliorations manifest.json** :
- Description de l'application
- Catégories (business, productivity, logistics)
- Raccourcis vers Tournée et Agenda
- Point d'entrée sur `/chauffeur`

**Card de configuration dans le dashboard** :
- Visible si app non installée OU permissions manquantes
- Checklist visuelle de l'état (✓ ou ⚠️) :
  - Application installée
  - GPS autorisé
  - Notifications activées
- Bouton "Installer l'application" (si disponible)
- Bouton "Configurer les permissions" (relance l'onboarding)
- Instructions pour iOS si installation non disponible
- Design attrayant avec gradient bleu/violet

---

### Notes techniques

- **PWA** : Progressive Web App installable (Android + iOS)
- **Permissions** : GPS + Notifications demandées explicitement
- **Installation** : Bouton "Installer l'app" pour Android, instructions Safari pour iOS
- **Stockage** : `localStorage` pour tracker l'onboarding complété
- **Help** : Page d'aide `/chauffeur/aide-permissions` accessible depuis la bannière
- **VROOM** : Utilise OpenRouteService API (gratuit, 500 req/jour)
- **TomTom** : Trafic prédictif (gratuit, 2500 req/jour)
- **Géocodage** : Nominatim (OpenStreetMap) - 1 req/seconde max
- **Routing** : OSRM public ou TomTom avec trafic
- **Base de données** : PostgreSQL sur Neon
- **Déploiement** : Render (backend) + Vercel/Netlify (frontend)
