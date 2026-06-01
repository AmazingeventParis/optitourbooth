# Webhook CRM → OptiTour (mise à jour temps réel)

OptiTour peut se synchroniser **dès qu'une info apparaît dans le CRM**, sans
attendre le polling. Le CRM (Shootnbox `manager2/`, Smakk `manager/`) appelle un
webhook OptiTour à chaque création/modification pertinente.

## Côté OptiTour (FAIT, déployé)

**Endpoint** : `POST https://optitourbooth-api.swipego.app/api/pending-points/crm-webhook`

- **Auth** : header `x-api-key: 0704201925bbd9c825da37908dd62ceb23f4174612a052711ca08c783bac7df6`
- **Réponse** : `202` immédiat (le CRM n'attend pas le scrape).
- **Comportement** : planifie une sync débouncée (3s). Plusieurs appels en rafale
  = une seule sync. Verrou anti-concurrence + relance auto si un appel arrive
  pendant une sync.
- **Filet de sécurité** : un polling tourne toutes les 10 min même sans webhook.

**Body** (JSON, tout optionnel — purement informatif pour les logs) :
```json
{ "source": "shootnbox" | "smakk", "orderId": 1234, "numId": "FA14179" }
```
La sync reste globale et idempotente (par `externalId`) — pas besoin d'envoyer la
donnée modifiée, juste de signaler « quelque chose a changé ».

## Côté CRM (À FAIRE par toi / ton dev CRM)

Ajouter un appel HTTP non-bloquant aux endroits où une info utile à la logistique
est créée/modifiée :

- **Shootnbox `manager2/`** : à la soumission du formulaire client (celui qui
  alimente `otb_cfg_bulk.php`), à la création/modif d'une commande (status, dates,
  box_type, livraison/retrait), à l'assignation de bornes (readiness).
- **Smakk `manager/`** : à la soumission de `mail-infos-smk.php`, à la
  création/modif d'une commande (`_otb_orders.php`).

### Snippet PHP (à coller après l'enregistrement en base)

```php
// Notifier OptiTour qu'une info a changé (non bloquant : timeout court, erreurs ignorées)
function otb_notify($source, $orderId = null, $numId = null) {
    $payload = json_encode([
        'source'  => $source,        // 'shootnbox' ou 'smakk'
        'orderId' => $orderId,
        'numId'   => $numId,
    ]);
    $ch = curl_init('https://optitourbooth-api.swipego.app/api/pending-points/crm-webhook');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: 0704201925bbd9c825da37908dd62ceb23f4174612a052711ca08c783bac7df6',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,   // ne bloque pas le CRM si OptiTour est lent
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    @curl_exec($ch);   // erreurs volontairement ignorées : le polling 10 min rattrape
    curl_close($ch);
}

// Exemples d'appel :
// otb_notify('shootnbox', null, 'FA14179');   // après soumission formulaire client
// otb_notify('smakk', 3906);                  // après soumission mail-infos-smk
```

### Points d'attention
- **Non bloquant** : timeout 3s + erreurs ignorées → si OptiTour est momentanément
  indisponible, le CRM n'est pas ralenti et le polling 10 min rattrapera l'info.
- **Idempotent** : appeler le webhook plusieurs fois est sans danger (débounce +
  upsert par externalId).
- **Sécurité** : la clé `x-api-key` est partagée. Si elle fuite, la changer dans
  l'env Coolify `API_KEY_GOOGLE` + dans le snippet PHP.

## Test rapide (depuis n'importe quel terminal)
```bash
curl -i -X POST https://optitourbooth-api.swipego.app/api/pending-points/crm-webhook \
  -H "x-api-key: 0704201925bbd9c825da37908dd62ceb23f4174612a052711ca08c783bac7df6" \
  -H "Content-Type: application/json" \
  -d '{"source":"smakk","orderId":3906}'
# → HTTP 202 {"success":true,"data":{"accepted":true,"scheduled":true}}
```
