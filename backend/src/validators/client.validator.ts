import { z } from 'zod';

export const createClientSchema = z.object({
  nom: z.string().min(1, 'Nom requis').max(255),
  societe: z.string().max(255).optional().nullable(),
  email: z
    .string()
    .email('Email invalide')
    .transform((v) => v.toLowerCase().trim())
    .optional()
    .nullable(),
  telephone: z.string().max(200).optional().nullable(), // Augmenté pour supporter plusieurs numéros
  adresse: z.string().min(1, 'Adresse requise'),
  complementAdresse: z.string().optional().nullable(),
  codePostal: z.string().max(10).optional().nullable(),
  ville: z.string().max(100).optional().nullable(),
  pays: z.string().max(100).optional().default('France'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  instructionsAcces: z.string().optional().nullable(),
  contactNom: z.string().max(100).optional().nullable(),
  contactTelephone: z.string().max(200).optional().nullable(), // Augmenté pour supporter plusieurs numéros
});

export const updateClientSchema = z.object({
  nom: z.string().min(1).max(255).optional(),
  societe: z.string().max(255).optional().nullable(),
  email: z
    .string()
    .email('Email invalide')
    .transform((v) => v.toLowerCase().trim())
    .optional()
    .nullable(),
  telephone: z.string().max(200).optional().nullable(), // Augmenté pour supporter plusieurs numéros
  adresse: z.string().min(1).optional(),
  complementAdresse: z.string().optional().nullable(),
  codePostal: z.string().min(1).max(10).optional(),
  ville: z.string().min(1).max(100).optional(),
  pays: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  instructionsAcces: z.string().optional().nullable(),
  contactNom: z.string().max(100).optional().nullable(),
  contactTelephone: z.string().max(200).optional().nullable(), // Augmenté pour supporter plusieurs numéros
  actif: z.boolean().optional(),
});

export const clientQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
  actif: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  ville: z.string().optional(),
  codePostal: z.string().optional(),
  search: z.string().optional(),
});

export const clientIdSchema = z.object({
  id: z.string().uuid('ID invalide'),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ClientQueryInput = z.infer<typeof clientQuerySchema>;
