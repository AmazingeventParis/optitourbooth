> **IMPORTANT** : Lis `project-state.md` au demarrage pour comprendre l'etat complet du projet.

# OptiTourBooth - Gestion de flotte et optimisation de tournees

## Stack
- **Backend** : Node.js 20 + Express + TypeScript + Prisma 5 + PostgreSQL 16 + PostGIS + Redis 7 + Socket.io
- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind 3 + Zustand + React Query 5 + Leaflet
- **Routing** : OSRM + VROOM (optimisation) + Nominatim (geocodage) + TomTom (trafic optionnel)

## Deploiement
- **API** : https://optitourbooth-api.swipego.app (UUID: `kgsgo448os84csgso4o88cwo`)
- **Web** : https://optitourbooth.swipego.app (UUID: `hooooowo888gwocoksc8c4gk`)
- **Repo (unique pour API+Web)** : github.com/AmazingeventParis/optitourbooth (remote `fork`)
- **Note** : Le remote `origin` (Pixoupix) n'a plus les droits push. Coolify API et Web pointent tous deux vers `AmazingeventParis/optitourbooth`.

## Commandes
```bash
# Dev
pnpm install && pnpm dev

# Deploy API + Frontend
git push fork master
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=kgsgo448os84csgso4o88cwo&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=hooooowo888gwocoksc8c4gk&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"
```

## Comptes
- **Super Admin** : superadmin@optitour.fr / SuperAdmin1! → /super-admin
- Les autres comptes (admin, chauffeur, etc.) doivent être créés manuellement via l'interface

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
- **Deploy** : push vers `fork` (pas `origin`), puis trigger Coolify pour les deux apps

## Base de donnees
- **Provider** : Neon (PostgreSQL serverless)
- **Host** : `ep-divine-tree-abtk5ljg-pooler.eu-west-2.aws.neon.tech`
- **DB** : `neondb` / **User** : `neondb_owner`
- **28 tables** dont : users, tenants, tournees, points, clients, produits, vehicules, billing_configs, billing_entries, preparations, machines, pending_points, etc.

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

## CRM Shootnbox (scraping)
- **URL CRM** : `https://www.shootnbox.fr/manager2/`
- **Login** : `d26386b04e.php` (POST event=login)
- **DB CRM** : MySQL `shoot2` (CRM) + `shoot` (WordPress)
- **Env vars** : `CRM_SHOOTNBOX_EMAIL`, `CRM_SHOOTNBOX_PASSWORD` (dans Coolify)
- **Cron email sync** (`crmSync.service.ts`) : toutes les heures, scrape 3 sources (orders_ajax status=2 + archives, readiness_ajax, albums_list), match par date + fuzzy nom (societe/contact), met a jour customerEmail + customerPhone sur les bookings
- **Cron photos sync** (`ringPhotosSync.service.ts`) : toutes les heures, scrape albums_list pour Ring+Vegas, telecharge photos depuis `shootnbox.fr/uploads/FAxxxxx/`, upload vers Google Drive via OAuth (pas service account — pas de quota). Matching Drive folders par date + nom.
- **OAuth Drive** : utilise `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` (le service account n'a pas de quota d'upload)

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
