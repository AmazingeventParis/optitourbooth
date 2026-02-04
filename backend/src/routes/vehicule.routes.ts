import { Router } from 'express';
import { vehiculeController } from '../controllers/vehicule.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// Liste des véhicules actifs (pour les selects) - accessible à tous
router.get('/actifs', asyncHandler(vehiculeController.listActifs));

// Routes admin uniquement
router.get('/', requireAdmin, asyncHandler(vehiculeController.list));
router.get('/:id', requireAdmin, asyncHandler(vehiculeController.getById));
router.post('/', requireAdmin, asyncHandler(vehiculeController.create));
router.put('/:id', requireAdmin, asyncHandler(vehiculeController.update));
router.delete('/:id', requireAdmin, asyncHandler(vehiculeController.delete));

export default router;
