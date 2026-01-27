import { Router } from 'express';
import { produitController } from '../controllers/produit.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { validate, validateMultiple } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createProduitSchema,
  updateProduitSchema,
  produitQuerySchema,
  produitIdSchema,
  createOptionSchema,
  updateOptionSchema,
} from '../validators/produit.validator.js';
import { z } from 'zod';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// Liste des produits actifs (accessible à tous les utilisateurs connectés)
router.get('/actifs', asyncHandler(produitController.listActifs));

// CRUD (admin seulement pour création/modification/suppression)
router.get('/', validate(produitQuerySchema, 'query'), asyncHandler(produitController.list));

router.get(
  '/:id',
  validate(produitIdSchema, 'params'),
  asyncHandler(produitController.getById)
);

// Routes admin
router.post(
  '/',
  requireAdmin,
  validate(createProduitSchema),
  asyncHandler(produitController.create)
);

router.put(
  '/:id',
  requireAdmin,
  validateMultiple({
    params: produitIdSchema,
    body: updateProduitSchema,
  }),
  asyncHandler(produitController.update)
);

router.delete(
  '/:id',
  requireAdmin,
  validate(produitIdSchema, 'params'),
  asyncHandler(produitController.delete)
);

// Options de produit
const optionIdSchema = z.object({
  id: z.string().uuid(),
  optionId: z.string().uuid(),
});

router.post(
  '/:id/options',
  requireAdmin,
  validateMultiple({
    params: produitIdSchema,
    body: createOptionSchema,
  }),
  asyncHandler(produitController.createOption)
);

router.put(
  '/:id/options/:optionId',
  requireAdmin,
  validateMultiple({
    params: optionIdSchema,
    body: updateOptionSchema,
  }),
  asyncHandler(produitController.updateOption)
);

router.delete(
  '/:id/options/:optionId',
  requireAdmin,
  validate(optionIdSchema, 'params'),
  asyncHandler(produitController.deleteOption)
);

export default router;
