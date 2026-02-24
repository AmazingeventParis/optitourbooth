import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse, slugify, parsePagination } from '../utils/index.js';
import { authService } from '../services/auth.service.js';
import { TenantPlan } from '@prisma/client';

const DEFAULT_CONFIGS: Record<TenantPlan, object> = {
  STARTER: {
    modules: { tournees: true, preparations: true, vehicules: true, produits: true, rapports: true, gps: true, notifications: true },
    limits: { maxUsers: 10, maxChauffeurs: 5, maxVehicules: 5 },
  },
  PRO: {
    modules: { tournees: true, preparations: true, vehicules: true, produits: true, rapports: true, gps: true, notifications: true },
    limits: { maxUsers: 50, maxChauffeurs: 20, maxVehicules: 20 },
  },
  ENTERPRISE: {
    modules: { tournees: true, preparations: true, vehicules: true, produits: true, rapports: true, gps: true, notifications: true },
    limits: { maxUsers: 999, maxChauffeurs: 999, maxVehicules: 999 },
  },
};

export const tenantController = {
  /**
   * GET /api/tenants
   * Liste paginée des tenants
   */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });
    const { active, search } = req.query as { active?: string; search?: string };

    const where: Record<string, unknown> = {};
    if (active !== undefined) {
      where.active = active === 'true';
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true } },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    apiResponse.paginated(res, tenants, { page, limit, total });
  },

  /**
   * GET /api/tenants/:id
   * Détails d'un tenant avec ses admins
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
        users: {
          where: { roles: { has: 'admin' } },
          select: {
            id: true,
            email: true,
            nom: true,
            prenom: true,
            roles: true,
            actif: true,
          },
        },
      },
    });

    if (!tenant) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    apiResponse.success(res, tenant);
  },

  /**
   * POST /api/tenants
   * Créer un nouveau tenant
   */
  async create(req: Request, res: Response): Promise<void> {
    const { name, slug: providedSlug, plan, config, active } = req.body;

    const finalSlug = providedSlug || slugify(name);

    // Vérifier unicité du slug
    const existing = await prisma.tenant.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      apiResponse.conflict(res, 'Ce slug est déjà utilisé');
      return;
    }

    const finalConfig = config || DEFAULT_CONFIGS[plan as TenantPlan] || DEFAULT_CONFIGS.STARTER;

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug: finalSlug,
        plan: plan || 'STARTER',
        config: finalConfig,
        active: active !== undefined ? active : true,
      },
      include: {
        _count: { select: { users: true } },
      },
    });

    apiResponse.created(res, tenant, 'Tenant créé');
  },

  /**
   * PUT /api/tenants/:id
   * Modifier un tenant
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name, slug, plan, config, active } = req.body;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    // Si slug change, vérifier unicité
    if (slug && slug !== existing.slug) {
      const slugExists = await prisma.tenant.findUnique({ where: { slug } });
      if (slugExists) {
        apiResponse.conflict(res, 'Ce slug est déjà utilisé');
        return;
      }
    }

    // Si plan change et pas de config custom, appliquer config par défaut du nouveau plan
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (plan !== undefined) {
      updateData.plan = plan;
      if (config === undefined) {
        updateData.config = DEFAULT_CONFIGS[plan as TenantPlan] || existing.config;
      }
    }
    if (config !== undefined) updateData.config = config;
    if (active !== undefined) updateData.active = active;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { users: true } },
      },
    });

    apiResponse.success(res, tenant, 'Tenant mis à jour');
  },

  /**
   * DELETE /api/tenants/:id
   * Désactiver un tenant (soft delete)
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    await prisma.tenant.update({
      where: { id },
      data: { active: false },
    });

    apiResponse.success(res, null, 'Tenant désactivé');
  },

  /**
   * POST /api/tenants/:id/admin
   * Créer un admin pour un tenant
   */
  async createTenantAdmin(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { email, password, nom, prenom, telephone } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    // Vérifier que l'email n'est pas déjà utilisé
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      apiResponse.conflict(res, 'Cet email est déjà utilisé');
      return;
    }

    const passwordHash = await authService.hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        roles: ['admin'],
        nom,
        prenom,
        telephone: telephone || null,
        tenantId: id,
      },
      select: {
        id: true,
        email: true,
        roles: true,
        nom: true,
        prenom: true,
        telephone: true,
        actif: true,
        tenantId: true,
        createdAt: true,
      },
    });

    apiResponse.created(res, user, 'Admin créé pour le tenant');
  },

  /**
   * GET /api/tenants/:id/users
   * Lister les utilisateurs d'un tenant
   */
  async listTenantUsers(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    const where = { tenantId: id };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          roles: true,
          nom: true,
          prenom: true,
          telephone: true,
          actif: true,
          tenantId: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    apiResponse.paginated(res, users, { page, limit, total });
  },
};
