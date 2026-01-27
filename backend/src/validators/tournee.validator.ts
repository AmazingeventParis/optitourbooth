import { z } from 'zod';
import { TourneeStatut, PointType, PointStatut } from '@prisma/client';

// ========== TOURNEE VALIDATORS ==========

export const tourneeIdSchema = z.object({
  id: z.string().uuid(),
});

export const tourneeQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  date: z.string().optional(), // Format YYYY-MM-DD
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  chauffeurId: z.string().uuid().optional(),
  statut: z.nativeEnum(TourneeStatut).optional(),
});

export const createTourneeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (YYYY-MM-DD)'),
  chauffeurId: z.string().uuid(),
  heureDepart: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional(),
  depotAdresse: z.string().optional(),
  depotLatitude: z.number().min(-90).max(90).optional(),
  depotLongitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
});

export const updateTourneeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (YYYY-MM-DD)').optional(),
  chauffeurId: z.string().uuid().optional(),
  statut: z.nativeEnum(TourneeStatut).optional(),
  heureDepart: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional().nullable(),
  heureFinEstimee: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional().nullable(),
  depotAdresse: z.string().optional().nullable(),
  depotLatitude: z.number().min(-90).max(90).optional().nullable(),
  depotLongitude: z.number().min(-180).max(180).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ========== POINT VALIDATORS ==========

export const pointIdSchema = z.object({
  id: z.string().uuid(),
  pointId: z.string().uuid(),
});

const pointProduitSchema = z.object({
  produitId: z.string().uuid(),
  quantite: z.number().int().min(1).default(1),
});

const pointOptionSchema = z.object({
  optionId: z.string().uuid(),
});

export const createPointSchema = z.object({
  clientId: z.string().uuid(),
  type: z.nativeEnum(PointType),
  creneauDebut: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional(),
  creneauFin: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional(),
  notesInternes: z.string().optional(),
  notesClient: z.string().optional(),
  produits: z.array(pointProduitSchema).min(1, 'Au moins un produit requis'),
  options: z.array(pointOptionSchema).optional(),
});

export const updatePointSchema = z.object({
  clientId: z.string().uuid().optional(),
  type: z.nativeEnum(PointType).optional(),
  statut: z.nativeEnum(PointStatut).optional(),
  ordre: z.number().int().min(0).optional(),
  creneauDebut: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional().nullable(),
  creneauFin: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)').optional().nullable(),
  notesInternes: z.string().optional().nullable(),
  notesClient: z.string().optional().nullable(),
  produits: z.array(pointProduitSchema).optional(),
  options: z.array(pointOptionSchema).optional(),
});

export const reorderPointsSchema = z.union([
  // Format original: { points: [{ id, ordre }] }
  z.object({
    points: z.array(z.object({
      id: z.string().uuid(),
      ordre: z.number().int().min(0),
    })),
  }),
  // Format simplifié: { pointIds: [] }
  z.object({
    pointIds: z.array(z.string().uuid()),
  }),
]);

// Schema pour déplacer un point vers une autre tournée
export const movePointSchema = z.object({
  targetTourneeId: z.string().uuid(),
  ordre: z.number().int().min(0).optional(), // Position dans la nouvelle tournée
});

// ========== TYPES ==========

export type CreateTourneeInput = z.infer<typeof createTourneeSchema>;
export type UpdateTourneeInput = z.infer<typeof updateTourneeSchema>;
export type CreatePointInput = z.infer<typeof createPointSchema>;
export type UpdatePointInput = z.infer<typeof updatePointSchema>;
export type ReorderPointsInput = z.infer<typeof reorderPointsSchema>;
export type MovePointInput = z.infer<typeof movePointSchema>;
