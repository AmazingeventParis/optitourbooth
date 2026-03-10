import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';

/**
 * Créer des notifications pour tous les admins d'un tenant
 */
export async function createForAdmins(
  tenantId: string | null,
  data: { type: string; title: string; body: string; metadata?: Record<string, any> }
): Promise<void> {
  // Trouver tous les admins/superadmins actifs
  const admins = await prisma.user.findMany({
    where: {
      actif: true,
      roles: { hasSome: ['admin', 'superadmin'] },
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true },
  });

  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type: data.type,
      title: data.title,
      body: data.body,
      metadata: data.metadata || undefined,
    })),
  });
}

/**
 * GET /api/notifications - Lister les notifications de l'utilisateur
 */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  apiResponse.success(res, { notifications, total, unreadCount });
}

/**
 * PATCH /api/notifications/:id/read - Marquer une notification comme lue
 */
export async function markAsRead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user!.id;

  try {
    await prisma.notification.update({
      where: { id, userId },
      data: { read: true },
    });
    apiResponse.success(res, { message: 'OK' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Notification non trouvée');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/notifications/mark-all-read - Marquer toutes comme lues
 */
export async function markAllAsRead(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;

  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });

  apiResponse.success(res, { message: 'OK' });
}
