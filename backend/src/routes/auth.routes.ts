import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../validators/auth.validator.js';

const router = Router();

// Routes publiques
router.post('/login', validate(loginSchema), asyncHandler(authController.login));
router.post('/refresh', validate(refreshTokenSchema), asyncHandler(authController.refresh));

// Routes protégées
router.use(authenticate);
router.get('/me', asyncHandler(authController.me));
router.post('/logout', validate(refreshTokenSchema), asyncHandler(authController.logout));
router.post('/logout-all', asyncHandler(authController.logoutAll));
router.put('/password', validate(changePasswordSchema), asyncHandler(authController.changePassword));

export default router;
