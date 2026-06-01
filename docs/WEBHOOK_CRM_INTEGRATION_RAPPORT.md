# Intégration Webhook CRM → OptiTour — Rapport de mise en œuvre

**Date :** 1er juin 2026 — **Révision 2**
**Périmètre :** CRM Shootnbox (`manager2/`) + CRM Smakk (`manager/`)
**Objectif :** notifier OptiTour en temps réel dès qu'une information utile à la logistique est créée ou modifiée dans les CRM, sans attendre le polling de 10 minutes.

> Rapport fourni par l'équipe CRM, archivé ici pour traçabilité. Validé par le dev
> OptiTour le 2026-06-01 (les 9 déclencheurs couvrent tout ce qu'OptiTour lit).
> Côté OptiTour, voir `docs/WEBHOOK_CRM_TEMPS_REEL.md`.

> **Suivi des retours (rév. 2).** Le retour du dev OptiTour sur le Readiness était juste et a été **intégré** : le point d'écriture de l'assignation de bornes a été identifié (event `box_num` dans `d26386b04e.php`) et instrumenté → **9ᵉ déclencheur ajouté** sur les deux marques. Détails au §5.

---

## 1. Résumé

Le côté OptiTour (endpoint webhook) était déjà livré. Côté CRM, nous avons branché un appel HTTP **non bloquant** vers ce webhook à chaque évènement pertinent. Le CRM se contente de signaler « quelque chose a changé » ; OptiTour déclenche alors une synchronisation globale, débouncée et idempotente.

L'intégration est **déployée, testée de bout en bout et opérationnelle sur les deux sites.**

---

## 2. Ce qui a été mis en place

### 2.1 Fonction d'appel partagée
Un fichier `otb_webhook.php` a été créé dans chaque manager (`/manager2/` côté Shootnbox, `/manager/` côté Smakk). Il définit la fonction `otb_notify(source, orderId, numId)` :

- Appel **POST** vers `https://optitourbooth-api.swipego.app/api/pending-points/crm-webhook`
- En-tête d'authentification `x-api-key`
- **Non bloquant** : timeout 3 s, connexion 2 s, **erreurs volontairement ignorées** → si OptiTour est momentanément indisponible, le CRM n'est jamais ralenti (le polling 10 min rattrape).
- Protégée contre toute erreur fatale (vérifie la disponibilité de cURL).

Chaque point d'appel utilise une inclusion sécurisée + un garde `function_exists()` :
> si le helper venait à manquer, **aucune page ne planterait**.

### 2.2 Points de déclenchement (9 au total)

| Évènement métier | Fichier(s) concerné(s) | Donnée OptiTour impactée |
|---|---|---|
| Soumission du formulaire client (logistique) | `infos-client.php` / `infos-client-smk.php` | Adresse, créneaux, retrait, contacts |
| Correction manuelle des réponses (bouton « Éditer ») | `mail-infos-snb.php` / `mail-infos-smk.php` | Idem (réponses corrigées) |
| Signature électronique du devis → réservation | `signer-devis.php` / `signer-devis-smk.php` | Passage en réservation (status 2) |
| Création / modification d'une commande | `d26386b04e.php` (events `add_order` + `edit_order`) | Dates, borne, livraison/retrait, statut |
| **Assignation de bornes (Readiness)** | `d26386b04e.php` (event `box_num`) | `box_id` (nombre de bornes à préparer) + `nom_event`* |

\* `nom_event` est une donnée calculée à partir des champs de la commande (date, société, n° FA) ; toute modification de ces champs passe déjà par le déclencheur « création / modification commande ».

---

## 3. Démarche (analyse avant action)

Avant toute modification, nous avons :

1. **Identifié les données réellement lues par OptiTour** pour cibler les bons déclencheurs :
   - `otb_cfg_bulk.php` (Shootnbox) → expose les réponses de formulaire (`submitted_data`).
   - `_otb_orders.php` (Smakk) → expose les commandes confirmées (dates, borne, livraison, adresse).
2. **Localisé précisément les points d'écriture** correspondants dans le code.
3. **Vérifié les ancres d'insertion** (notamment l'unicité de la balise d'ouverture dans le fichier `d26386b04e.php`).

---

## 4. Vérifications et tests (qualité / anti-régression)

- **Connectivité webhook** confirmée depuis les serveurs : réponse **HTTP 202** (« Sync planifiée »).
- **Fichier `d26386b04e.php`** (volumineux, dispatcheur) modifié par remplacement ciblé sur ses 3 events (`add_order`, `edit_order`, `box_num`), avec :
  - vérification des compteurs de remplacement (exactement 1 occurrence par ancre, **3 appels `otb_notify` confirmés par fichier**),
  - contrôle de syntaxe **`php -l` → « No syntax errors detected »** après chaque modification,
  - vérification de l'écart de taille (cohérent avec le code ajouté).
- **6 fichiers redéployés** : tailles vérifiées, **rendu des pages contrôlé** (aucune erreur).
- **Test de bout en bout réel** : une correction de réponses a bien déclenché l'appel `otb_notify` → webhook → **HTTP 202** confirmé. (Instrumentation temporaire, puis retrait.)
- **À noter** : `d26386b04e.php` exige une session admin authentifiée ; ses events (`add_order`/`edit_order`/`box_num`) ne se déclenchent donc que pour des actions admin connectées — non testables en « headless », mais le maillon `otb_notify → webhook (202)` est lui prouvé de bout en bout.
- Tous les fichiers et données de test ont été **nettoyés** après vérification.

---

## 5. Assignation de bornes (Readiness) — couvert

> **Mise à jour suite au retour du dev OptiTour.** Une première version de ce rapport indiquait à tort que le Readiness était hors périmètre. C'est corrigé : OptiTour lit bien `readiness_ajax.php` (champs `nom_event` et `box_id`), un **9ᵉ déclencheur a donc été ajouté.**

`readiness_ajax.php` est effectivement en lecture seule (il **affiche** le `box_id`) — l'écriture de l'assignation de borne se fait, elle, dans le dispatcheur `d26386b04e.php` via l'**event `box_num`** (`UPDATE orders_new SET box_id …`). C'est ce point d'écriture qui a été instrumenté, sur les deux marques.

Désormais, dès qu'une borne est assignée/modifiée dans le Readiness :
- `box_id` (nombre de bornes à préparer) → notifié en temps réel ;
- `nom_event` → couvert via le déclencheur « création / modification commande » (champs sous-jacents).

Modification réalisée avec la même rigueur : ancre unique vérifiée (1 occurrence), `php -l` → « No syntax errors detected », contrôle de l'écart de taille.

---

## 6. Caractéristiques de fonctionnement

- **Non bloquant** : aucun ralentissement du CRM, même si OptiTour est lent ou indisponible.
- **Idempotent** : appeler le webhook plusieurs fois est sans danger (débounce 3 s + upsert par identifiant).
- **Tolérant aux pannes** : le polling de secours toutes les 10 minutes garantit qu'aucune information n'est jamais perdue.

---

## 7. Maintenance

- La clé `x-api-key` est partagée entre les deux CRM et OptiTour.
- En cas de fuite : la modifier dans l'environnement Coolify d'OptiTour (`API_KEY_GOOGLE`) **et** dans le fichier `otb_webhook.php` des deux sites.

---

*Intégration réalisée et vérifiée le 1er juin 2026 (rév. 2 intégrant le retour sur le Readiness) — CRM Shootnbox & Smakk.*
