import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { validate, validateMultiple } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createUserSchema,
  updateUserSchema,
  userQuerySchema,
  userIdSchema,
} from '../validators/user.validator.js';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// Route spéciale pour les chauffeurs (accessible aux admins)
router.get('/chauffeurs', asyncHandler(userController.listChauffeurs));

// Routes admin seulement
router.use(requireAdmin);

router.get('/', validate(userQuerySchema, 'query'), asyncHandler(userController.list));

router.get(
  '/:id',
  validate(userIdSchema, 'params'),
  asyncHandler(userController.getById)
);

router.post('/', validate(createUserSchema), asyncHandler(userController.create));

router.put(
  '/:id',
  validateMultiple({
    params: userIdSchema,
    body: updateUserSchema,
  }),
  asyncHandler(userController.update)
);

router.delete(
  '/:id',
  validate(userIdSchema, 'params'),
  asyncHandler(userController.delete)
);

export default router;
