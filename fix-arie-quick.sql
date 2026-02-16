-- SOLUTION RAPIDE : Restaurer la tournée d'Arié
-- Copiez-collez ces requêtes dans Neon Console SQL Editor

-- ÉTAPE 1 : Voir l'état actuel de la tournée d'Arié
SELECT
  t.id,
  t.date,
  t.statut,
  t."heureDepart",
  t."heureFinReelle",
  u.prenom || ' ' || u.nom as chauffeur,
  COUNT(p.id) as nb_points
FROM tournees t
JOIN users u ON t."chauffeurId" = u.id
LEFT JOIN points p ON p."tourneeId" = t.id
WHERE t.date >= '2026-02-16'
  AND t.date < '2026-02-17'
  AND (u.prenom ILIKE '%ari%' OR u.nom ILIKE '%ari%')
GROUP BY t.id, t.date, t.statut, t."heureDepart", t."heureFinReelle", u.prenom, u.nom;

-- ÉTAPE 2 : RESTAURER - Changer le statut de "terminee" à "en_cours"
-- ⚠️ Remplacez <ID_TOURNEE> par l'ID affiché dans l'étape 1
UPDATE tournees
SET
  statut = 'en_cours',
  "heureFinReelle" = NULL
WHERE id = '<ID_TOURNEE>';

-- ÉTAPE 3 : VÉRIFICATION - La tournée devrait maintenant apparaître dans le planning
SELECT
  t.id,
  t.date,
  t.statut,
  u.prenom || ' ' || u.nom as chauffeur,
  p.ordre,
  c.nom as client,
  p.statut as statut_point
FROM tournees t
JOIN users u ON t."chauffeurId" = u.id
LEFT JOIN points p ON p."tourneeId" = t.id
LEFT JOIN clients c ON p."clientId" = c.id
WHERE t.id = '<ID_TOURNEE>'
ORDER BY p.ordre;
