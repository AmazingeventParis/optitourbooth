import { Router } from 'express';
import * as machineController from '../controllers/machine.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Toutes les routes nécessitent une authentification admin
router.use(authenticate, requireAdmin);

router.get('/', asyncHandler(machineController.listMachines));
router.get('/:id', asyncHandler(machineController.getMachine));

export default router;
