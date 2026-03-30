import { Router } from 'express';
import multer from 'multer';
import * as machineController from '../controllers/machine.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Configuration multer pour l'upload d'images
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Utilisez JPEG, PNG, WebP ou SVG'));
    }
  },
});

const router = Router();

// Routes de lecture accessibles aux préparateurs et warehouse
router.get('/', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(machineController.listMachines));
router.get('/:id', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(machineController.getMachine));

// Routes d'action réservées aux admins, préparateurs et warehouse
router.use(authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'));

// Upload d'image pour un type de machine
router.post(
  '/type/:type/image',
  imageUpload.single('image'),
  asyncHandler(machineController.uploadMachineImage)
);

// Actions sur les machines
router.get('/:id/incidents', asyncHandler(machineController.listMachineIncidents));
router.post('/:id/defect', asyncHandler(machineController.markMachineDefect));
router.delete('/:id/defect', asyncHandler(machineController.clearMachineDefect));
router.post('/:id/out-of-service', asyncHandler(machineController.markMachineOutOfService));
router.post('/:id/restore-service', asyncHandler(machineController.restoreMachineToService));
router.patch('/:id/remote-id', asyncHandler(machineController.updateRemoteId));

export default router;
