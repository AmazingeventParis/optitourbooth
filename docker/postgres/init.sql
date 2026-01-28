-- Initialisation de la base de données OptiTour Booth
-- Active les extensions nécessaires

-- Extension PostGIS pour les requêtes géospatiales
CREATE EXTENSION IF NOT EXISTS postgis;

-- Extension pour générer des UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Extension pour la recherche full-text améliorée
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Vérification des extensions installées
SELECT 'PostGIS version: ' || PostGIS_Version();
