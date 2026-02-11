import { Router } from 'express';
import multer from 'multer';
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

// Configuration multer pour l'upload d'avatars
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Utilisez JPEG, PNG ou WebP'));
    }
  },
});

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

// Avatar routes
router.post(
  '/:id/avatar',
  validate(userIdSchema, 'params'),
  avatarUpload.single('avatar'),
  asyncHandler(userController.uploadAvatar)
);

router.delete(
  '/:id/avatar',
  validate(userIdSchema, 'params'),
  asyncHandler(userController.deleteAvatar)
);

export default router;
