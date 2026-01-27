import { z } from 'zod';

export const createProduitSchema = z.object({
  nom: z.string().min(1, 'Nom requis').max(255),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide').optional().nullable(),
  dureeInstallation: z.number().int().min(0).default(30),
  dureeDesinstallation: z.number().int().min(0).default(20),
  poids: z.number().positive().optional().nullable(),
  largeur: z.number().positive().optional().nullable(),
  hauteur: z.number().positive().optional().nullable(),
  profondeur: z.number().positive().optional().nullable(),
});

export const updateProduitSchema = z.object({
  nom: z.string().min(1).max(255).optional(),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide').optional().nullable(),
  dureeInstallation: z.number().int().min(0).optional(),
  dureeDesinstallation: z.number().int().min(0).optional(),
  poids: z.number().positive().optional().nullable(),
  largeur: z.number().positive().optional().nullable(),
  hauteur: z.number().positive().optional().nullable(),
  profondeur: z.number().positive().optional().nullable(),
  actif: z.boolean().optional(),
});

export const produitQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
  actif: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const produitIdSchema = z.object({
  id: z.string().uuid('ID invalide'),
});

// Options de produit
export const createOptionSchema = z.object({
  nom: z.string().min(1, 'Nom requis').max(255),
  description: z.string().optional().nullable(),
  dureeSupp: z.number().int().min(0).default(0),
});

export const updateOptionSchema = z.object({
  nom: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  dureeSupp: z.number().int().min(0).optional(),
  actif: z.boolean().optional(),
});

export type CreateProduitInput = z.infer<typeof createProduitSchema>;
export type UpdateProduitInput = z.infer<typeof updateProduitSchema>;
export type ProduitQueryInput = z.infer<typeof produitQuerySchema>;
export type CreateOptionInput = z.infer<typeof createOptionSchema>;
export type UpdateOptionInput = z.infer<typeof updateOptionSchema>;
