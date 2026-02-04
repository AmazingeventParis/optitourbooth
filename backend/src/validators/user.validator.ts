import { z } from 'zod';
import { UserRole } from '@prisma/client';

// Validation de couleur hexadécimale
const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const createUserSchema = z.object({
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
  role: z.nativeEnum(UserRole),
  nom: z.string().min(1, 'Nom requis').max(100),
  prenom: z.string().min(1, 'Prénom requis').max(100),
  telephone: z.string().max(20).optional(),
  couleur: z.string().regex(hexColorRegex, 'Couleur hexadécimale invalide').optional(),
  // Véhicule
  vehicule: z.string().max(100).optional(),
  immatriculation: z.string().max(20).optional(),
  consommationL100km: z.number().min(0).max(50).optional(),
});

export const updateUserSchema = z.object({
  email: z
    .string()
    .email('Email invalide')
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre'
    )
    .optional(),
  role: z.nativeEnum(UserRole).optional(),
  nom: z.string().min(1).max(100).optional(),
  prenom: z.string().min(1).max(100).optional(),
  telephone: z.string().max(20).optional().nullable(),
  couleur: z.string().regex(hexColorRegex, 'Couleur hexadécimale invalide').optional().nullable(),
  actif: z.boolean().optional(),
  // Véhicule
  vehicule: z.string().max(100).optional().nullable(),
  immatriculation: z.string().max(20).optional().nullable(),
  consommationL100km: z.number().min(0).max(50).optional().nullable(),
});

export const userQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
  role: z.nativeEnum(UserRole).optional(),
  actif: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const userIdSchema = z.object({
  id: z.string().uuid('ID invalide'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
