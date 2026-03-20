import { Router } from 'express';
import * as preparationController from '../controllers/preparation.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Toutes les routes nécessitent authentification + rôle preparateur, warehouse, admin ou superadmin
router.use(authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'));

router.get('/', asyncHandler(preparationController.listPreparations));
router.post('/cleanup-auto', asyncHandler(preparationController.cleanupAutoPreparations));
router.get('/:id', asyncHandler(preparationController.getPreparation));
router.post('/', asyncHandler(preparationController.createPreparation));
router.patch('/:id', asyncHandler(preparationController.updatePreparation));
router.delete('/:id', asyncHandler(preparationController.deletePreparation));

// Actions spécifiques
router.post('/:id/ready', asyncHandler(preparationController.markAsReady));
router.post('/:id/unload-photos', asyncHandler(preparationController.markPhotosUnloaded));
router.post('/:id/photos-not-unloaded', asyncHandler(preparationController.markPhotosNotUnloaded));
router.post('/:id/defect', asyncHandler(preparationController.markMachineDefect));
router.post('/:id/out-of-service', asyncHandler(preparationController.markOutOfService));

export default router;
