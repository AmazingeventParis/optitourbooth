import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { authenticate, requireAdmin, requireWarehouse } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateSettingsSchema } from '../validators/settings.validator.js';

const router = Router();

router.use(authenticate);

// Lecture accessible au warehouse
router.get('/', requireWarehouse, asyncHandler(settingsController.get));

// Écriture admin seulement
router.put('/', requireAdmin, validate(updateSettingsSchema), asyncHandler(settingsController.update));

export default router;
