import { z } from 'zod';
import { TenantPlan } from '@prisma/client';

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug invalide (lettres minuscules, chiffres et tirets)').optional(),
  plan: z.nativeEnum(TenantPlan).optional().default('STARTER'),
  config: z.record(z.unknown()).optional(),
  active: z.boolean().optional().default(true),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug invalide').optional(),
  plan: z.nativeEnum(TenantPlan).optional(),
  config: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

export const tenantIdSchema = z.object({
  id: z.string().uuid('ID invalide'),
});

export const tenantQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
  active: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const createTenantAdminSchema = z.object({
  email: z
    .string()
    .email('Email invalide')
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre'
    ),
  nom: z.string().min(1, 'Nom requis').max(100),
  prenom: z.string().min(1, 'Prénom requis').max(100),
  telephone: z.string().max(20).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type TenantQueryInput = z.infer<typeof tenantQuerySchema>;
export type CreateTenantAdminInput = z.infer<typeof createTenantAdminSchema>;
