-- AlterEnum
ALTER TYPE "TourneeStatut" ADD VALUE 'brouillon' BEFORE 'planifiee';

-- Update default value for new tournees
ALTER TABLE "tournees" ALTER COLUMN "statut" SET DEFAULT 'brouillon';
