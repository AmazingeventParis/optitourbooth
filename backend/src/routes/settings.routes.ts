import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateSettingsSchema } from '../validators/settings.validator.js';

const router = Router();

// Toutes les routes nécessitent authentification + admin
router.use(authenticate);
router.use(requireAdmin);

router.get('/', asyncHandler(settingsController.get));
router.put('/', validate(updateSettingsSchema), asyncHandler(settingsController.update));

export default router;
