> **IMPORTANT** : Lis `project-state.md` au demarrage pour comprendre l'etat complet du projet.

# OptiTourBooth - Gestion de flotte et optimisation de tournees

## Stack
- **Backend** : Node.js 20 + Express + TypeScript + Prisma 5 + PostgreSQL 16 + PostGIS + Redis 7 + Socket.io
- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind 3 + Zustand + React Query 5 + Leaflet
- **Routing** : OSRM + VROOM (optimisation) + Nominatim (geocodage) + TomTom (trafic optionnel)

## Deploiement
- **API** : https://optitourbooth-api.swipego.app (UUID: `kgsgo448os84csgso4o88cwo`)
- **Web** : https://optitourbooth.swipego.app (UUID: `hooooowo888gwocoksc8c4gk`)
- **Repo API** : github.com/AmazingeventParis/optitourbooth
- **Repo Web** : github.com/Pixoupix/optitourbooth

## Commandes
```bash
# Dev
pnpm install && pnpm dev

# Deploy API
git push origin master
curl -s -X GET "https://coolify.swipego.app/api/v1/deploy?uuid=kgsgo448os84csgso4o88cwo&force=true" \
  -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"
```

## Comptes test
- Admin: vincent.pixerelle@gmail.com / testtesT1!
- Admin: admin@shootnbox.fr / admin123
- Chauffeur: chauffeur@shootnbox.fr / chauffeur123

## Regles importantes
- **Dates** : TOUJOURS utiliser `ensureDateUTC()` de `backend/src/utils/dateUtils.ts` (jamais `new Date("YYYY-MM-DD")`)
- **Telephones** : utiliser `parsePhoneNumbers()` de `backend/src/utils/phoneParser.ts`
- **Build** : `NODE_ENV=development` dans le builder Docker (sinon pnpm skip devDeps)
- **Prisma** : `prisma db push` (pas migrate deploy), installer `prisma@5` explicitement
- **Tests** : exclus du build prod via tsconfig.json exclude

## Problemes connus resolus
- Timezone UTC: `new Date("YYYY-MM-DD")` en France donne jour precedent → `ensureDateUTC()`
- Auto-dispatch: spread operator copiait objet → retourner reference
- PWA blank: start_url "/chauffeur" → "/"
- Coolify NODE_ENV: force development dans builder
- TypeScript TS2742: tsconfig.build.json avec declaration: false
- libssl.so.1.1: Alpine → apk add openssl
