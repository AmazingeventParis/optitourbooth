import { Router } from 'express';
import * as controller from '../controllers/pendingPoint.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { apiKeyAuth } from '../middlewares/apiKey.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// API externe (Google Apps Script) - authentification par clé API
router.post('/', apiKeyAuth, asyncHandler(controller.createPendingPoints));

// API interne (Frontend) - authentification JWT
router.get('/', authenticate, requireRole('admin', 'warehouse', 'superadmin'), asyncHandler(controller.listPendingPoints));
router.delete('/:id', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.deletePendingPoint));
router.patch('/:id/dispatch', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.markDispatched));

export default router;
