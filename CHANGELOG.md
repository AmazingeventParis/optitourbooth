# Changelog OptiTourBooth

Journal des gros travaux. Le plus récent en haut.

---

## 2026-06-01 (suite) — Sync CRM temps réel (webhook)

### ⚡ Webhook temps réel + polling 10 min — DÉPLOYÉ
- **Objectif** : OptiTour se met à jour dès qu'une info apparaît dans le CRM,
  sans attendre le sync horaire.
- **Endpoint** (commit `5d09eb7`) : `POST /api/pending-points/crm-webhook`
  (auth `x-api-key`). Réponse **202 en ~80ms** (le CRM n'attend pas le scrape).
- **Garde-fous** : débounce 3s (rafale de N webhooks = 1 sync, testé sur 5),
  verrou anti-concurrence, relance auto si un webhook arrive pendant une sync.
- **Filet de sécurité** : polling abaissé de 60 → **10 min** (rattrape si un
  webhook se perd). Sync bookings (emails/photos, lourde) reste horaire (1/6 ticks).
- **Côté CRM (À FAIRE par l'équipe CRM)** : ajouter un appel PHP non-bloquant au
  webhook à la soumission des formulaires / création-modif de commandes.
  Snippet + doc complète : `docs/WEBHOOK_CRM_TEMPS_REEL.md`.

---

## 2026-06-01 (suite) — Formulaire info-client Smakk

Suite au signalement « infos formulaire Smakk LABEL EQUIPEE (04/06) non importées ».

### Diagnostic
- Le **bouton Sync fonctionne**. Le parseur du formulaire info-client Smakk
  (`parseSmakkInfoClientHtml`) **fonctionne aussi** (testé sur HTML réel : extrait
  correctement adresse, dates, créneaux, contact). ⚠️ Deux fausses pistes
  écartées en cours de route (« pas un tableau », « parseur cassé ») — c'était
  bien un tableau `<td>` et le regex matchait.
- **Vraie cause** : le point était `manuallyEdited=true`, posé par l'ANCIEN bug
  (`manuallyEdited: hasInfoClient`) avant le fix `c2aecae`. Verrouillé → le sync
  refusait de réinjecter le formulaire. Mesure : **25 points CRM de juin** étaient
  ainsi faussement verrouillés (sur 121).

### 🐛 Bug adresse livraison/récupération Smakk — CORRIGÉ
- Le formulaire Smakk a 2 lignes « Adresse » et « Adresse récupération ». Le
  parseur écrivait les deux dans le même champ → le point **livraison** récupérait
  l'adresse de **récupération** (la 2ème écrasait la 1ère).
- **Fix** (commit `d2db5db`) : champ `recAdresse` séparé dans `SmakkInfoClient`.
  Le label contenant « récup » → adresse de ramassage ; sinon → livraison. Le
  point ramassage utilise `recAdresse` (fallback adresse livraison).

### Déverrouillage LABEL EQUIPEE (ciblé)
- Route maintenance temp (commits `d2db5db` → `8b77b9f`) → `manuallyEdited=false`
  sur `smk_order_3906`. Après sync, import **parfait** vérifié :
  - Livraison 04/06 16:00-18:30, adresse « 5 allee raymond negre, Joinville »
  - Ramassage 06/06 11:00-13:00, adresse « 23 Bis Quai de la marne, Joinville »
  - Contact Frédéric Casales · 06 30 92 51 79
- Les 24 autres points verrouillés restent figés (choix utilisateur : juste tester
  LABEL EQUIPEE). Déverrouillage global possible plus tard si besoin.

---

## 2026-06-01 — Fiabilité import : re-sync formulaire client & nettoyage GCal

### 🐛 BUG MAJEUR — `manuallyEdited` figeait le formulaire client — CORRIGÉ
- **Symptôme** : dates / créneaux / adresses faux et figés à l'import. Si le
  client corrigeait son formulaire dans le CRM **après** le 1er import,
  OptiTour ne le reprenait jamais (resté sur la date commande, souvent fausse).
  Cas : TORREMOCHA (FA14179) importé au 06/06 alors que le formulaire dit 04/06.
- **Cause racine** : à la création, le sync posait `manuallyEdited=true` dès
  qu'un formulaire/info-client CRM existait (`manuallyEdited: !!form` /
  `: hasInfoClient`). Ce flag (censé signifier « édité par un humain ») bloquait
  ensuite TOUTE re-synchronisation du formulaire client.
- **Fix** (commit `c2aecae`) : séparer les 2 notions. Le sync ne pose plus
  jamais `manuallyEdited` — réservé aux éditions via l'UI (PATCH). Les gardes
  `!manuallyEdited` restent (les corrections manuelles admin ne sont pas
  écrasées), mais tous les autres points re-suivent la dernière version du
  formulaire client à chaque sync. 8 emplacements (Shootnbox + Smakk,
  liv/rec, create+update). Vérifié en prod : `enriched=36` au sync suivant.

### 🧹 Nettoyage 363 résidus Google Calendar
- GCal n'est plus une source depuis le 27/05. 363 `pending_points`
  `source=google_calendar` traînaient encore (doublons, ex. DALKIA). Route
  maintenance temporaire (commits `2b6a2d4` → `4ff395b`) → soft-delete des 363.
  Planning vérifié propre (0 résidu GCal visible au 04-05/06).

### ⚠️ Limites identifiées (pas des bugs de code)
- **TORREMOCHA** et autres points déjà corrigés à la main restent figés
  (`manuallyEdited=true`) — choix utilisateur de ne pas les déverrouiller.
  Le fix vaut pour les futurs imports.
- **DALKIA** (FA14031) : le ramassage tombe le même jour que la livraison car
  **aucun formulaire client n'est rempli** côté CRM et `return_date=event_date`.
  La vraie date de retour n'existe nulle part dans les données CRM exposées →
  non corrigeable tant que le client ne remplit pas son formulaire.
- **LABEL EQUIPEE** (FA5468) : import **correct** (produit=Smakk, source
  crm_smakk). Le « classé Vegas » perçu vient de l'affichage (préparations /
  agenda / borne `R1/P`), pas du pipeline — non investigué (non prioritaire).

### Note sur le pipeline d'import (sources des infos client)
- **Shootnbox** : commande `orders_ajax.php?status=2` (box_type, dates fallback)
  + formulaire client `otb_cfg_bulk.php` (dates/créneaux/adresse/contact —
  PRIORITAIRE) + readiness `readiness_ajax.php` (event, bornes).
- **Smakk** : commande `_otb_orders.php` (JSON) + readiness `readiness_ajax.php`
  + info client `mail-infos-smk.php` (prioritaire).
- Priorité dates Shootnbox : `formulaire.log_jour_liv || commande.event_date`.

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
