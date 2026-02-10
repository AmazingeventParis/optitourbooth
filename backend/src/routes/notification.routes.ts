import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { apiResponse } from '../utils/index.js';
import { config } from '../config/index.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/notifications/vapid-public-key
 * Returns the VAPID public key for the client to subscribe
 */
router.get(
  '/vapid-public-key',
  asyncHandler(async (_req: Request, res: Response) => {
    apiResponse.success(res, { publicKey: config.webPush.publicKey });
  })
);

/**
 * POST /api/notifications/subscribe
 * Subscribe the current user to push notifications
 */
router.post(
  '/subscribe',
  asyncHandler(async (req: Request, res: Response) => {
    const { endpoint, keys } = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      apiResponse.badRequest(res, 'Subscription data invalide');
      return;
    }

    const sub = await notificationService.subscribe(req.user!.id, { endpoint, keys });
    apiResponse.success(res, sub, 'Abonnement push enregistré');
  })
);

/**
 * DELETE /api/notifications/unsubscribe
 * Unsubscribe an endpoint
 */
router.delete(
  '/unsubscribe',
  asyncHandler(async (req: Request, res: Response) => {
    const { endpoint } = req.body as { endpoint: string };

    if (!endpoint) {
      apiResponse.badRequest(res, 'Endpoint requis');
      return;
    }

    await notificationService.unsubscribe(endpoint);
    apiResponse.success(res, null, 'Abonnement push supprimé');
  })
);

export default router;
