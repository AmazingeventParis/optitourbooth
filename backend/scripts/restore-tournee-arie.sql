-- Script d'urgence pour restaurer la tournée d'Arié du 16 février 2026
-- À exécuter via Neon Console ou psql

-- 1. DIAGNOSTIC : Trouver la tournée d'Arié terminée à tort
SELECT
  t.id,
  t.date,
  t.statut,
  t."heureFinReelle",
  u.prenom || ' ' || u.nom as chauffeur,
  COUNT(p.id) as nb_points
FROM tournees t
JOIN users u ON t."chauffeurId" = u.id
LEFT JOIN points p ON p."tourneeId" = t.id
WHERE t.date = '2026-02-16'
  AND u.prenom = 'Arié'
GROUP BY t.id, t.date, t.statut, t."heureFinReelle", u.prenom, u.nom;

-- 2. RESTAURER la tournée d'Arié (passer de 'terminee' à 'en_cours' ou 'planifiee')
-- Remplacer <TOURNEE_ID> par l'ID trouvé ci-dessus
/*
UPDATE tournees
SET
  statut = 'en_cours',
  "heureFinReelle" = NULL
WHERE id = '<TOURNEE_ID>';
*/

-- 3. TROUVER les points qui ont été réassignés au mauvais chauffeur
SELECT
  p.id,
  p.ordre,
  c.nom as client,
  t.id as tournee_id,
  u.prenom || ' ' || u.nom as chauffeur_actuel,
  t.date
FROM points p
JOIN clients c ON p."clientId" = c.id
JOIN tournees t ON p."tourneeId" = t.id
JOIN users u ON t."chauffeurId" = u.id
WHERE t.date = '2026-02-16'
  AND u.prenom != 'Arié'
  AND c.nom IN (
    -- REMPLACER par les noms des 2 clients d'Arié
    'NOM_CLIENT_1',
    'NOM_CLIENT_2'
  );

-- 4. DÉPLACER les points vers la tournée d'Arié
-- Remplacer <POINT_ID_1>, <POINT_ID_2> et <TOURNEE_ARIE_ID>
/*
UPDATE points
SET "tourneeId" = '<TOURNEE_ARIE_ID>'
WHERE id IN ('<POINT_ID_1>', '<POINT_ID_2>');
*/

-- 5. VÉRIFICATION : Vérifier que la tournée d'Arié a bien ses 2 points
SELECT
  t.id,
  t.date,
  t.statut,
  u.prenom || ' ' || u.nom as chauffeur,
  p.ordre,
  c.nom as client
FROM tournees t
JOIN users u ON t."chauffeurId" = u.id
LEFT JOIN points p ON p."tourneeId" = t.id
LEFT JOIN clients c ON p."clientId" = c.id
WHERE t.date = '2026-02-16'
  AND u.prenom = 'Arié'
ORDER BY p.ordre;
