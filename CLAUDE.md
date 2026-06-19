> **IMPORTANT** : Lis `project-state.md` au demarrage pour comprendre l'etat complet du projet.

# OptiTourBooth - Gestion de flotte et optimisation de tournees

## Stack
- **Backend** : Node.js 20 + Express + TypeScript + Prisma 5 + PostgreSQL 16 + PostGIS + Redis 7 + Socket.io
- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind 3 + Zustand + React Query 5 + Leaflet
- **Routing** : OSRM + VROOM (optimisation) + BAN api-adresse.data.gouv.fr (geocodage France, prioritaire) + Nominatim (fallback) + TomTom (trafic optionnel)

## Deploiement

### URLs et UUIDs
- **API** : https://optitourbooth-api.swipego.app (UUID Coolify: `kgsgo448os84csgso4o88cwo`)
- **Web** : https://optitourbooth.swipego.app (UUID Coolify: `hooooowo888gwocoksc8c4gk`)
- **Coolify** : https://coolify.swipego.app (heberge sur 217.182.89.133)
- **Repo GitHub** : github.com/AmazingeventParis/optitourbooth (branche `master`)

### Git - Push et credentials
Les remotes `origin` et `fork` pointent tous les deux vers `AmazingeventParis/optitourbooth` avec le token configure.
```bash
# Remote origin configure avec token (pret a l'emploi)
git remote set-url origin https://AmazingeventParis:<TOKEN>@github.com/AmazingeventParis/optitourbooth.git
```
**Push** : `git push origin master` fonctionne directement.

### Commandes de deploiement
```bash
# 1. Push le code
git push origin master

# 2. Deployer l'API
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=kgsgo448os84csgso4o88cwo&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"

# 3. Deployer le Frontend
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=hooooowo888gwocoksc8c4gk&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"
```
Les 3 commandes peuvent etre chainees : `git push origin master && curl ... && curl ...`
Le build prend environ 2-3 minutes par app.

### Build APK Android (local)

**⚠️ Depuis le 2026-06-19, l'APK charge le web en direct** (`server.url = https://optitourbooth.swipego.app` dans `capacitor.config.ts`, commit `5d823c3`). Conséquence : un correctif **frontend déployé est visible sur l'APK sans rebuild**. On ne reconstruit l'APK QUE pour un changement de config native (plugins, server.url, permissions, icône) — pas pour un bug de code applicatif. Contrepartie : l'app a besoin du réseau au lancement (pas de repli hors-ligne).

**⚠️ JDK 21 + Gradle :** le dossier `frontend/android/` est régénéré par `npx cap add android` avec **Gradle 8.2.1**, qui **plante sous JDK 21** (« Unsupported class file / could not determine java version »). Avant `assembleDebug`, monter le wrapper à **8.7** (compatible JDK 21 et AGP 8.2.1) :
```powershell
# frontend/android/gradle/wrapper/gradle-wrapper.properties
# distributionUrl=...gradle-8.7-all.zip   (au lieu de 8.2.1)
(Get-Content android\gradle\wrapper\gradle-wrapper.properties) -replace 'gradle-8\.2\.1-all\.zip','gradle-8.7-all.zip' | Set-Content android\gradle\wrapper\gradle-wrapper.properties
```
Alternative : utiliser un JDK 17. (Ces fichiers étant git-ignorés, ce correctif est à refaire à chaque régénération du dossier `android/`.)

**Prérequis installés le 2026-05-18 :**
- JDK 21 : `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot`
- Android SDK : `C:\Users\shoot\AppData\Local\Android\Sdk` (build-tools 34.0.0 + platform android-34)

**Commande complète (PowerShell, depuis `frontend/`) :**
```powershell
$env:ANDROID_HOME = "C:\Users\shoot\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = "C:\Users\shoot\AppData\Local\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"

# Build Vite + sync Capacitor + assembler le debug APK
npx vite build --mode capacitor
npx cap sync android
cd android; .\gradlew assembleDebug --no-daemon; cd ..

# Copier l'APK dans public/downloads
Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" "public\downloads\optitour.apk" -Force
```

**Ou en une ligne avec le script npm :**
```powershell
# (apres avoir set les env vars ci-dessus)
npm run apk
```

**Puis committer et deployer :**
```powershell
cd .. # retour a la racine du repo
git add frontend/public/downloads/optitour.apk
git commit -m "build: update Android APK $(Get-Date -Format 'yyyy-MM-dd')"
git push origin master
# Trigger Coolify frontend
Invoke-WebRequest -Uri "http://217.182.89.133:8000/api/v1/deploy?uuid=hooooowo888gwocoksc8c4gk&force=true" -Headers @{ Authorization = "Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576" } -UseBasicParsing
```

**Note :** Si `cap add android` est nécessaire (premiere fois ou apres suppression du dossier android/) :
```powershell
npx cap add android  # avant cap sync
```
Le dossier `frontend/android/` est gitignore — il doit etre recree a chaque clone.

---

### Commandes dev local
```bash
pnpm install && pnpm dev
```

## Serveur de production (217.182.89.133)
- **OS** : Linux (Coolify self-hosted)
- **Coolify API Token** : `1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576`
- **Services heberges** : OptiTour API, OptiTour Web, RustDesk, Redis, etc.

## Comptes
- **Super Admin** : superadmin@optitour.fr / SuperAdmin1! → /super-admin
- Les autres comptes (admin, chauffeur, preparateur) doivent etre crees via l'interface

## Architecture multi-tenant
- **Modele Tenant** : name, slug (unique), plan (STARTER/PRO/ENTERPRISE), config JSON, active
- **User.tenantId** : nullable (null = superadmin sans tenant)
- **Roles** : superadmin, admin, chauffeur, preparateur
- **Config par defaut** : STARTER (10/5/5), PRO (50/20/20), ENTERPRISE (999/999/999) — maxUsers/maxChauffeurs/maxVehicules
- **Routes /api/tenants** : protegees par authenticate + requireSuperAdmin
- **Seed** : toujours execute au demarrage (upsert idempotent), cree tenant Shootnbox + superadmin

## Regles importantes
- **Dates** : TOUJOURS utiliser `ensureDateUTC()` de `backend/src/utils/dateUtils.ts` (jamais `new Date("YYYY-MM-DD")`)
- **Telephones** : utiliser `parsePhoneNumbers()` de `backend/src/utils/phoneParser.ts`
- **Build** : `NODE_ENV=development` dans le builder Docker (sinon pnpm skip devDeps)
- **Prisma** : `prisma db push` (pas migrate deploy), installer `prisma@5` explicitement
- **Tests** : exclus du build prod via tsconfig.json exclude
- **Deploy** : push vers `origin` puis trigger Coolify pour les deux apps (API + Web)

## Base de donnees
- **Provider** : Neon (PostgreSQL serverless)
- **Host** : `ep-divine-tree-abtk5ljg-pooler.eu-west-2.aws.neon.tech`
- **DB** : `neondb` / **User** : `neondb_owner`
- **28 tables** dont : users, tenants, tournees, points, clients, produits, vehicules, billing_configs, billing_entries, preparations, machines, pending_points, bookings, etc.

## Google Calendar Sync (DESACTIVEE depuis 2026-05-27)

**Source unique des pending_points : CRM Shootnbox + CRM Smakk.**
Le service `googleCalendar.service.ts` existe toujours mais `startGoogleCalendarSync()` est commentee dans `app.ts`.
L'endpoint `POST /api/pending-points/sync-google-calendar` retourne un no-op.
Le bouton "Sync" dans `/planning` declenche desormais le CRM sync (`POST /pending-points/sync-crm`).

Script de nettoyage DB : `cleanup-gcal-pending-points.sql` (soft-delete les points GCal non-dispatches restants).

### Table `pending_points` (PendingPoint)
Sources actives :
- **CRM Shootnbox** : 2 points par commande (`snb_order_{orderId}_livraison` / `_ramassage`) — source = `crm_shootnbox`
- **CRM Smakk** : 2 points par commande (`smk_order_{orderId}_livraison` / `_ramassage`) — source = `crm_smakk`

Champs cles :
- `dispatched` : true = deja dans une tournee. NE JAMAIS remettre a false dans les blocs UPDATE du sync CRM — l'etat dispatche est permanent jusqu'a action utilisateur.
- `usedInPreparation` : true = utilise pour creer une preparation de borne
- `produitNom` : Vegas, Ring, Smakk, Miroir, Spinner, Aircam, Playbox (normalise via `normalizeBoxType()`). **Re-synchronise a chaque sync** depuis le box_type CRM (hors `manuallyEdited`) — avant le fix d1a8c6f (2026-06-11), il etait fige a la creation et ne suivait pas un changement de borne dans le CRM.
- `eventName` : nom d'evenement issu de readiness.php (Shootnbox + Smakk)

### Regles de filtrage CRM → pending_points

**Shootnbox** (`syncCrmPendingPoints` dans `crmSync.service.ts`) :
- Source : `orders_ajax.php?status=2` (actif) + `?status=2&arch=true` (archives)
- Filtre champ `delivery` (HTML strippé, lowercase) :
  - Doit contenir `livraison` ou `installation`
  - Si contient `retrait` ou `chronopost` → skip
- Skip si `form.logType === 'chronopost' || 'retrait'`
- `eventName` : issu de `readiness_ajax.php` (scrape avec session cookie)

**Smakk** (`syncCrmPendingPoints` dans `crmSync.service.ts`) :
- Source : `_otb_orders.php` (JSON API, clé `opti2026smk_x7kR9qNv`)
- **Filtre positif** sur `delivery_options` (lowercase) :
  - Doit contenir `livraison` ou `installation` — sinon skip
  - `delivery_options` vide → skip (peut etre retrait boutique sans option renseignee)
  - "Retrait Boutique", "Chronopost", "" → tous exclus
- Nettoyage automatique a chaque sync : supprime les pending_points Smakk futurs dont l'orderId n'est plus dans la liste eligible (ex : commande passee en retrait apres import)
- `eventName` : issu de `_otb_readiness.php` (champ `nom_event`)

### Routes API pending points
| Methode | Route | Auth | Role |
|---------|-------|------|------|
| POST | `/api/pending-points` | API Key | Creation externe (legacy Google Apps Script) |
| POST | `/api/pending-points/manual` | JWT | admin+ : creation manuelle |
| GET | `/api/pending-points?date=YYYY-MM-DD` | JWT | Liste points non-dispatched pour une date |
| GET | `/api/pending-points?search=xxx` | JWT | Recherche par nom client |
| GET | `/api/pending-points/calendar-events?calendarType=shootnbox\|smakk` | JWT | Evenements pour preparations |
| PATCH | `/api/pending-points/:id` | JWT | admin+ : mise a jour |
| PATCH | `/api/pending-points/:id/dispatch` | JWT | admin+ : marquer dispatche |
| DELETE | `/api/pending-points/:id` | JWT | admin+ : suppression |
| POST | `/api/pending-points/sync-google-calendar` | JWT | admin+ : sync manuelle |
| POST | `/api/pending-points/sync-crm` | JWT | admin+ : sync CRM manuelle |
| GET | `/api/pending-points/sync-status` | JWT | Resultat du dernier sync CRM (cron ou manuel) |

### Alerte panne sync CRM (`/planning`)
Le resultat du dernier sync (`lastPendingPointsSyncResult`, in-memory) est expose via `GET /pending-points/sync-status`. `DailyPlanningPage` l'interroge au chargement puis toutes les 5 min : si `errors` non vide, **bandeau rouge** en haut de la page avec le detail et l'heure du dernier essai. Une panne du cron horaire n'est donc plus silencieuse (mis en place apres la panne Smakk www du 2026-06-11).

### Frontend
- **Service** : `frontend/src/services/pendingPoints.service.ts`
- **Planning** : `frontend/src/pages/DailyPlanningPage.tsx` — points a dispatcher
- **Preparations** : `frontend/src/pages/PreparationsPage.tsx` — calendar events pour prep bornes
- **Agenda** : `frontend/src/pages/AgendaPage.tsx` — vue calendrier allocations machines

## Systeme de facturation (billing)
- **Grille tarifaire** : `/parametres` > Compta chauffeurs > Grille tarifaire
  - Par chauffeur : tarif point HF, tarif heure supp, plage horaire HF (debut/fin), tarifs custom
  - Option "Chauffeur independant" : tous les points = hors forfait (pas de plage horaire)
- **Detection HF sur planning** : `/planning` detecte automatiquement les points hors forfait selon la config du chauffeur
  - Badge HF sur les cartes point (contour = detecte, plein = facture)
  - Section HF dans le modal d'edition point avec intitule, quantite, prix
- **Historique compta** : `/parametres` > Compta chauffeurs > Historique compta
  - Types : point_hors_forfait, heure_supp, custom, payment
  - Paiements (type=payment) : credit deduit du solde
  - Toggle "marquer paye" (paidAt) sur chaque ligne de charge
  - Resume : Du (charges) / Paye (paiements) / Solde (balance)
  - "Calculer auto" genere les entrees depuis les tournees (points HF + heures supp basees sur horaires des points)
- **Quantites** : toujours entieres, Math.ceil sur toute unite entamee (1.4 → 2)
- **Heures supp** : calculees a partir des horaires reels des points (pas heureFinReelle de la tournee)

## RustDesk (Telemaintenance)
- **Serveur** : auto-heberge sur 217.182.89.133 (meme serveur qu'OptiTour)
- **Image** : `rustdesk/rustdesk-server-s6:latest` (hbbs + hbbr dans un seul container)
- **UUID Coolify** : `x8wod0q6y4rim13oxyefnlcx`
- **Container** : `x8wod0q6y4rim13oxyefnlcx-152219957358`
- **Volume** : `rustdesk-data:/data`
- **Ports** : 21115/tcp, 21116/tcp+udp, 21117/tcp, 21118/tcp, 21119/tcp
- **Cle publique** : `7B7IEnlStsJzsT8xF6KzMyh+HB2UiFtLRpXPJsHMBRo=`
- **Config borne** : ID Server = `217.182.89.133`, Relay Server = `217.182.89.133`, Key = cle ci-dessus
- **Mot de passe par defaut** : `Laurytal2` (pre-rempli sur les 55 machines Vegas+Smakk)
- **Page OptiTour** : `/telemaintenance` (admin only)
- **IMPORTANT** : Le container a ete recree manuellement avec `-p 21116:21116/udp` car Coolify ne mappait pas l'UDP. Si Coolify redeploy, il faut re-ajouter le mapping UDP.

## CRM Shootnbox + Smakk

### Shootnbox
- **URL CRM** : `https://www.shootnbox.fr/manager2/`
- **Login** : `d26386b04e.php` (POST event=login)
- **DB CRM** : MySQL `shoot2` (CRM) + `shoot` (WordPress)
- **Env vars** : `CRM_SHOOTNBOX_EMAIL`, `CRM_SHOOTNBOX_PASSWORD` (dans Coolify)
- **Cron email sync** (`crmSync.service.ts`) : toutes les heures, scrape 3 sources (orders_ajax status=2 + archives, readiness_ajax, albums_list), match par date + fuzzy nom (societe/contact), met a jour customerEmail + customerPhone sur les bookings
- **Cron photos sync** (`ringPhotosSync.service.ts`) : toutes les heures, scrape albums_list pour Ring+Vegas, telecharge photos depuis `shootnbox.fr/uploads/FAxxxxx/`, upload vers Google Drive via OAuth (pas service account — pas de quota). Matching Drive folders par date + nom.
- **OAuth Drive** : utilise `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` (le service account n'a pas de quota d'upload)

### Smakk
- **URL CRM** : `https://smakk.fr/manager/` — **SANS www** : depuis juin 2026, `www.smakk.fr/manager/x.php` redirige 301 vers `smakk.fr/x.php` (perd `/manager`) → 404 WordPress. Cette panne a bloque tout le sync Smakk pendant ~2 jours (erreur "Smakk API HTTP 404").
- **Repli automatique** : tous les appels au manager Smakk passent par `smakkFetch()` (`crmSync.service.ts`) qui essaie `smakk.fr/manager` puis `www.smakk.fr/manager` et memorise la variante qui repond. Couvre : orders, readiness, mail-infos-smk, login, chronopost.
- **API JSON** : `https://smakk.fr/manager/_otb_orders.php?key=opti2026smk_x7kR9qNv` (pas de session, cle fixe)
- **Readiness** : `POST https://smakk.fr/manager/readiness_ajax.php` (draw=1&start=0&length=500, sans auth) — champ `box_id` = colonne N (IDs bornes assignees ex: "R3/P"), champ `delivery` = type HTML. `_otb_readiness.php` n'existe PAS (retourne WordPress).
- **Formulaire info-client** : `mail-infos-smk.php?ajax=get_responses&order_id={id}` (session cookie) — source de verite pour adresse livraison, dates reelles, creneaux, contact et **notes** (champ "Notes" importe depuis 2026-06-11, commit 1c76e07).
- **Cron pending_points** : toutes les heures via `syncCrmPendingPoints()` dans `crmSync.service.ts`
- **Filtre livraison** : filtre POSITIF sur `delivery_options` — doit contenir "livraison" ou "installation". Vide ou "Retrait Boutique" → exclu. Voir section "Regles de filtrage" ci-dessus.

## Systeme email Galeries Clients

### Architecture
- **Service** : `backend/src/services/email.service.ts`
- **SMTP** : `smtp.office365.com:587` (STARTTLS) — partage entre les deux marques
- **Deux marques** : `SHOOTNBOX` et `SMAKK`, chacune avec ses propres credentials

### Fonctions email (email.service.ts)
| Fonction | Bouton /galeries | Contenu |
|----------|-----------------|---------|
| `sendReviewLinkEmail` | **Envoyer Avis APP** | Shootnbox : phrase MyShootnbox + badges App Store/Google Play. Smakk : bouton CTA galerie. Met a jour emailSentAt + notifie MyShootnbox. |
| `sendOldStyleReviewLinkEmail` | **Envoyer Avis Mail** | Les deux marques : preview photos + "et X autres photos vous attendent..." + bouton CTA "Acceder a ma galerie". Pas de mention app. |
| `sendGalleryDirectEmail` | Envoyer Drive | Lien direct Drive (sans page avis) |

### Endpoints backend
- `POST /api/bookings/:id/send-link-email` → `sendReviewLinkEmail` (persiste `senderBrand` + `emailSentAt`)
- `POST /api/bookings/:id/send-mail-avis` → `sendOldStyleReviewLinkEmail` (persiste `senderBrand`, pas `emailSentAt`)
- `POST /api/bookings/:id/send-gallery` → `sendGalleryDirectEmail`

### Resolution de marque (page avis publique + redirections)
- `resolveBookingBrand()` (`backend/src/utils/brandUtils.ts`) : `senderBrand` sinon repli `crmBrand` (minuscules) sinon SHOOTNBOX. Utilise dans `handleReviewClick` (redirect avis), `getBookingByToken` (branding page), `manualSendGallery`, `galleryDispatch.service.ts`.
- **Bug corrige (e8e660f, 2026-06-11)** : `send-mail-avis` ne persistait pas `senderBrand` → clients Smakk rediriges vers Trustpilot/MyBusiness de Shootnbox.
- **URLs d'avis (env Coolify API)** :
  - `GOOGLE_REVIEW_URL_SHOOTNBOX` = `https://g.page/r/CV9hJZofgnkSEAE/review`
  - `GOOGLE_REVIEW_URL_SMAKK` = `https://g.page/r/CSz6ryamhiE4EAE/review`
  - `TRUSTPILOT_REVIEW_URL_SMAKK` = `https://public.trustindex.io/review/write/www.smakk.fr` (Smakk utilise Trustindex, pas Trustpilot)
  - `TRUSTPILOT_REVIEW_URL_SHOOTNBOX` : defaut hardcode dans `config/index.ts` (`fr.trustpilot.com/evaluate/shootnbox.fr`)
- **Priorite Google** : `booking.googleReviewUrl` (si non null) > URL par marque > `GOOGLE_DEFAULT_REVIEW_URL` (non configuree).

### Variables d'environnement (Coolify)
| Variable | Valeur |
|----------|--------|
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `EMAIL_SHOOTNBOX` | `contact@shootnbox.fr` |
| `EMAIL_SHOOTNBOX_PASSWORD` | configuré |
| `EMAIL_SMAKK` | `contact@smakk.fr` |
| `EMAIL_SMAKK_PASSWORD` | configuré (mai 2026) |

### Compte Microsoft 365 Smakk (`contact@smakk.fr`)
- **Tenant** : SMAKK.FR (entra.microsoft.com)
- **Affichage** : Smakk Hello
- **MFA** : desactive (necessaire pour SMTP de base)
- **SMTP AUTH** : active sur la boite aux lettres
- **IMPORTANT** : apres plusieurs tentatives echouees, Microsoft applique un Smart Lockout automatique temporaire (~10-15 min). Ne pas tenter plusieurs mots de passe incorrects de suite.

## Problemes connus resolus
- Timezone UTC: `new Date("YYYY-MM-DD")` en France donne jour precedent → `ensureDateUTC()`
- Auto-dispatch: spread operator copiait objet → retourner reference
- PWA blank: start_url "/chauffeur" → "/"
- Coolify NODE_ENV: force development dans builder
- TypeScript TS2742: tsconfig.build.json avec declaration: false
- libssl.so.1.1: Alpine → apk add openssl
- Frontend repo Coolify: change de Pixoupix vers AmazingeventParis (pas de droits push sur Pixoupix)
- Login superadmin: LoginPage faisait navigate('/') en dur → redirection par role
- Seed non execute sur DB existante: start.sh modifie pour toujours lancer seed (upsert idempotent)
- Google Calendar Smakk→Vegas: evenements (LIR) sur agenda Smakk detectes comme Vegas au lieu de Smakk → calendrier Smakk rendu prioritaire sur le mapping tag par defaut
- Google Calendar dispatched fantome: points marques dispatched a tort lors du re-sync → update recalcule dispatched selon presence reelle en tournee
- GPS WhatsApp mauvaise adresse: Nominatim geocodait mal les adresses françaises atypiques (esplanades, rues recentes) → coordonnees stockees en DB pointaient vers un endroit different → liens Maps/Waze incorrects. Fix: BAN (api-adresse.data.gouv.fr) en geocodeur primaire + bouton "Recalculer GPS" dans fiche client pour corriger l'existant (`geocoding.service.ts` + `ClientsPage.tsx`)
- Smakk retraits importes en points a dispatcher : filtre negatif `includes('retrait')` laissait passer les commandes avec `delivery_options=""` → remplace par filtre positif (doit contenir "livraison" ou "installation") + nettoyage auto a chaque sync (`crmSync.service.ts`)
- Avis Smakk rediriges vers Shootnbox (e8e660f) : `send-mail-avis` ne persistait pas `senderBrand` → page avis resolvait la marque a null = Shootnbox. Fix : persistance + `resolveBookingBrand()` avec repli `crmBrand` (repare aussi les mails deja envoyes)
- Sync Smakk en panne totale "HTTP 404" (9e5fd9f + 4d9836c) : changement Apache cote smakk.fr — www perdait `/manager` a la redirection. Fix : base sans www + `smakkFetch()` avec repli entre variantes + bandeau d'alerte sync dans `/planning`
- produitNom fige a la creation (d1a8c6f) : un changement de borne dans le CRM apres le 1er import n'etait jamais reflete (cas Grollier FA5530 affiche "Vegas" au lieu de "Smakk") → re-sync a chaque passage hors `manuallyEdited`
- Notes formulaire Smakk perdues (1c76e07) : la ligne "Notes" de mail-infos-smk n'etait pas parsee → champ ajoute a `SmakkInfoClient` + create/update liv/rec

## Ameliorations a implementer (backlog)

### Google Calendar : suppression durable des pending_points (manuallyDeleted)
**Probleme** : supprimer un pending_point dans OptiTour n'empeche pas la sync de le recreer si l'evenement Google Calendar existe encore (ou a un delai de propagation).
**Solution proposee** :
1. Ajouter champ `manuallyDeleted: Boolean @default(false)` sur le modele `PendingPoint` dans Prisma
2. Le endpoint DELETE (si le point a un `externalId`) fait un soft-delete : `manuallyDeleted: true` + `dispatched: true` au lieu de supprimer la ligne
3. Dans `syncGoogleCalendarEvents()`, avant chaque upsert, verifier si le record existant a `manuallyDeleted: true` → skip complet (ne pas toucher la ligne)
**Comportement attendu** :
- Point supprime manuellement → jamais recrée, meme si l'agenda Google le retourne encore
- Recréer l'evenement dans Google Calendar → nouvel Event ID → non bloque → importe normalement
- Le bloc est par Google Event ID (externalId), pas par nom client → pas de faux positifs si orthographe differente
