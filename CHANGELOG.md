# Changelog OptiTourBooth

Journal des gros travaux. Le plus récent en haut.

---

## 2026-05-29 — Fiabilité import CRM & affichage planning

Session de debug suite à des prestations manquantes dans OptiTour
(« OptiTour pas fiable »). Quatre problèmes distincts identifiés et traités.

### 🐛 Bug A — Points fantômes (dispatched=true sans tournée) — CORRIGÉ
- **Symptôme** : une prestation CRM n'apparaît nulle part — ni dans « à
  dispatcher », ni dans une tournée. Cas : FINAFIVE (smk_order_3746), CIC
  ORSAY ARCHANGE (snb_order_18531).
- **Cause racine** : aucun lien stocké entre un `Point` (en tournée) et son
  `PendingPoint`. Au dispatch, `markDispatched` met `dispatched=true` sans
  référence inverse. Au retrait d'un point / suppression / annulation de
  tournée, le flag restait `true` → point invisible à vie.
- **Fix durable** (commit `2ffe44a`, backend, **SANS migration DB**) : helper
  `reopenPendingForDepartedPoints()` dans `tournee.controller.ts`, branché sur
  `deletePoint`, tournée `delete` et `cancel`. Rapproche par date+type+nom
  normalisé et remet `dispatched=false`. Ignore `deletedByUser=true`. En catch
  silencieux (ne bloque jamais l'action). **Testé end-to-end en prod.**
- **Réparation de l'existant** (route maintenance temporaire, créée puis
  retirée) : **195 points fantômes** traités sur 241 dispatchés →
  **60 CRM** remis « à dispatcher » + **135 Google Calendar legacy**
  soft-deletés. Doublons obsolètes supprimés (CIC `snb_order_22329`
  inexistant côté CRM, Finafive legacy GCal).

### 🐛 Bug B — Mauvaise date à l'import (Shootnbox) — CORRIGÉ
- **Symptôme** : CIC ORSAY ARCHANGE bloqué au 30/06 au lieu du 30/05.
- **Cause** : le bloc UPDATE du sync Shootnbox ne réécrivait jamais le champ
  `date` (présent uniquement dans le bloc CREATE) → date erronée figée à vie.
- **Fix** (commit `95aec88`) : resync de `date` depuis le CRM/formulaire tant
  que `manuallyEdited=false`, côté livraison + ramassage (Smakk le faisait
  déjà). Source de vérité = formulaire client `otb_cfg_bulk.php`
  (champs `log_jour_liv` / `log_jour_rec` / `log_creneau_*`).

### 🐛 Affichage planning — Race condition — CORRIGÉ
- **Symptôme** : en naviguant vite entre dates (flèches, retour arrière),
  l'écran se vidait parfois (« plus aucun point/tournée »), corrigé au F5.
- **Cause** : une réponse réseau lente (ex. date vide) écrasait l'affichage
  de la date courante. Aucune garde anti-réponse-périmée.
- **Fix** (commit `9f6302b`, frontend) : garde `cancelled` + comparaison de
  la date demandée sur les 2 chargements (pending points + tournées) +
  cleanup `useEffect`.

### 🔧 Build frontend cassé depuis `e0f5a6b` (déploiement impossible) — CORRIGÉ
- **Découverte** : le commit de retrait de Google Calendar avait laissé
  `AgendaPage` appelant `pendingPointsService.syncGoogleCalendar()` (supprimé)
  + un import `WrenchScrewdriverIcon` inutilisé → `tsc -b` échouait →
  **aucun déploiement frontend ne passait** depuis ce commit. Plusieurs
  correctifs frontend n'avaient jamais atteint la prod (explique les bugs
  d'affichage « persistants » côté utilisateur).
- **Fix** (commit `9b85ead`) : `syncGoogleCalendar()` → `syncCrm()` dans
  AgendaPage, suppression de l'import inutilisé. Frontend redéployé OK.
- ⚠️ **Règle** : toujours typecheck AVANT push — backend
  `npx tsc -p tsconfig.build.json --noEmit`, frontend `npx tsc -b` (strict,
  échoue sur imports/variables inutilisés). Un build raté = `deploy failed`
  silencieux, l'ancienne version reste en prod. Vérifier `status=finished`
  via `GET /api/v1/deployments/{uuid}`.

### ℹ️ Vérifié : pas de limite d'horizon à l'import
- Aucun plafond type J+14. Une presta de décembre est importée dès
  aujourd'hui. Seul filtre de date = le passé est exclu (`event_date < today`,
  côté Shootnbox `crmSync.service.ts:982` et Smakk `:1197`).

### 🐛 Bug C — Résidus Shootnbox (commande disparue du CRM) — CORRIGÉ
- **Symptôme** : une presta repassée en « demande » / retrait / annulée côté
  CRM Shootnbox reste visible dans OptiTour. Cas : Denis Lecluse
  (`snb_order_17054`, 01-02/06), CIC `snb_order_22329`.
- **Cause** : le nettoyage des `pending_points` dont l'orderId n'est plus
  éligible existait pour Smakk mais PAS pour Shootnbox.
- **Fix** (commit `6a3b8a8`) : symétrie avec Smakk — à chaque sync, suppression
  des points `crm_shootnbox` dont l'orderId n'est plus dans la liste éligible.
  **Garde-fou** (plus prudent que Smakk) : uniquement les points
  `dispatched=false` ET `deletedByUser=false` — un point déjà dans une tournée
  est conservé. Testé en prod : points Lecluse retirés au sync suivant.

### Commits de la session
`95aec88` (resync date + route maintenance) → `220e14f` (fix import build) →
`9b5710e` (repair différencié CRM/GCal) → `ddbd773` (retrait route) →
`2ffe44a` (réouverture pending au retrait) → `9f6302b` (race condition) →
`9b85ead` (réparation build frontend) → `6a3b8a8` (cleanup Shootnbox Bug C).
