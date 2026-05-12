import { Router } from 'express';
import * as chronopostController from '../controllers/chronopost.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(authenticate, requireRole('admin', 'superadmin'));

router.get('/', asyncHandler(chronopostController.listExpeditions));
router.post('/add', asyncHandler(chronopostController.addExpedition));
router.post('/sync-all', asyncHandler(chronopostController.syncAll));
router.get('/session', asyncHandler(chronopostController.getChronotraceSessionStatus));
router.post('/session', asyncHandler(chronopostController.updateChronotraceSession));
router.patch('/:id', asyncHandler(chronopostController.updateExpedition));
router.delete('/:id', asyncHandler(chronopostController.deleteExpedition));
router.post('/:id/sync', asyncHandler(chronopostController.syncExpedition));
router.post('/:id/return', asyncHandler(chronopostController.markAsReturned));

export default router;
