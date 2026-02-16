# Parser intelligent de numéros de téléphone

## Vue d'ensemble

Le système détecte automatiquement plusieurs numéros de téléphone dans une seule chaîne de texte, avec support des indicatifs internationaux et différents séparateurs.

## Fonctionnalités

### Détection automatique de plusieurs numéros

L'utilisateur peut saisir plusieurs numéros dans un seul champ, séparés par :
- `,` (virgule)
- `;` (point-virgule)
- `/` (slash)
- `\` (backslash)
- `|` (pipe)
- `_` (underscore)

### Support des formats multiples

**Séparateurs internes dans un numéro** (un seul numéro) :
- `06 12 34 56 78` (espaces)
- `06.12.34.56.78` (points)
- `06-12-34-56-78` (tirets)

**Numéros internationaux** :
- `+33612345678`
- `+33 6 12 34 56 78`

**Normalisation automatique** :
- `612345678` → `0612345678` (ajoute le 0 si 9 chiffres)

## Utilisation

### Backend

```typescript
import { parsePhoneNumbers, formatPhoneNumbers } from '../utils/phoneParser.js';

// Parser
const phones = parsePhoneNumbers("06 12 34 56 78, 07 98 76 54 32");
// Résultat : ["0612345678", "0798765432"]

// Formater
const formatted = formatPhoneNumbers(phones);
// Résultat : "06 12 34 56 78, 07 98 76 54 32"
```

### Intégration automatique

Le parsing est appliqué automatiquement dans :

1. **Import Excel** (`import.service.ts`)
   - Colonne `TELEPHONE` parsée automatiquement
   - Plusieurs numéros détectés et formatés

2. **Création de client** (`client.controller.ts`)
   - Champ `contactTelephone` normalisé avant sauvegarde
   - Format : `"06 12 34 56 78, 07 98 76 54 32"`

3. **Mise à jour de client** (`client.controller.ts`)
   - Normalisation lors de l'update

### Frontend

Le frontend affiche un helper dans les formulaires :

```
💡 Vous pouvez saisir plusieurs numéros séparés par , / - ou espace
```

Fichiers modifiés :
- `frontend/src/pages/DailyPlanningPage.tsx`
- `frontend/src/pages/ClientsPage.tsx`

## Exemples d'utilisation

### Import Excel

**Avant** : Un seul numéro possible
```
TELEPHONE
0612345678
```

**Après** : Plusieurs numéros détectés
```
TELEPHONE
06 12 34 56 78, 07 98 76 54 32
06.12.34.56.78 / 01.23.45.67.89
+33612345678 / 0798765432
```

### Formulaire manuel

L'utilisateur peut maintenant saisir :
```
06 12 34 56 78, 07 98 76 54 32
```

Et le système stocke automatiquement au format formaté :
```
"06 12 34 56 78, 07 98 76 54 32"
```

## Tests

Tous les tests sont dans `backend/src/utils/phoneParser.test.ts`.

Exécuter les tests :
```bash
cd backend
npx tsx src/utils/phoneParser.test.ts
```

## Validation

- Minimum 8 chiffres par numéro
- Support indicatif international (`+` au début)
- Normalisation automatique (ajout du 0 si 9 chiffres)

## Stockage

Les numéros sont stockés dans la base de données au format :
```
"06 12 34 56 78, 07 98 76 54 32"
```

Avantages :
- Lisible pour l'utilisateur
- Facile à parser
- Compact (pas de JSON)
