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
