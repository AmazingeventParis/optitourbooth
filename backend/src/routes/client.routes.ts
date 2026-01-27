import { Router } from 'express';
import { clientController } from '../controllers/client.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate, validateMultiple } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createClientSchema,
  updateClientSchema,
  clientQuerySchema,
  clientIdSchema,
} from '../validators/client.validator.js';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// Routes de recherche et filtres
router.get('/search', asyncHandler(clientController.search));
router.get('/villes', asyncHandler(clientController.listVilles));

// CRUD
router.get('/', validate(clientQuerySchema, 'query'), asyncHandler(clientController.list));

router.get(
  '/:id',
  validate(clientIdSchema, 'params'),
  asyncHandler(clientController.getById)
);

router.post('/', validate(createClientSchema), asyncHandler(clientController.create));

router.put(
  '/:id',
  validateMultiple({
    params: clientIdSchema,
    body: updateClientSchema,
  }),
  asyncHandler(clientController.update)
);

router.delete(
  '/:id',
  validate(clientIdSchema, 'params'),
  asyncHandler(clientController.delete)
);

// Action spéciale : re-géocoder
router.post(
  '/:id/geocode',
  validate(clientIdSchema, 'params'),
  asyncHandler(clientController.geocode)
);

export default router;
