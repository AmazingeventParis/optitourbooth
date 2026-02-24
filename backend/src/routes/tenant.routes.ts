import { Router } from 'express';
import { tenantController } from '../controllers/tenant.controller.js';
import { authenticate, requireSuperAdmin } from '../middlewares/auth.middleware.js';
import { validate, validateMultiple } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createTenantSchema,
  updateTenantSchema,
  tenantIdSchema,
  tenantQuerySchema,
  createTenantAdminSchema,
} from '../validators/tenant.validator.js';

const router = Router();

// Toutes les routes nécessitent authentification + superadmin
router.use(authenticate);
router.use(requireSuperAdmin);

router.get('/', validate(tenantQuerySchema, 'query'), asyncHandler(tenantController.list));

router.get(
  '/:id',
  validate(tenantIdSchema, 'params'),
  asyncHandler(tenantController.getById)
);

router.post('/', validate(createTenantSchema), asyncHandler(tenantController.create));

router.put(
  '/:id',
  validateMultiple({
    params: tenantIdSchema,
    body: updateTenantSchema,
  }),
  asyncHandler(tenantController.update)
);

router.delete(
  '/:id',
  validate(tenantIdSchema, 'params'),
  asyncHandler(tenantController.delete)
);

router.post(
  '/:id/admin',
  validateMultiple({
    params: tenantIdSchema,
    body: createTenantAdminSchema,
  }),
  asyncHandler(tenantController.createTenantAdmin)
);

router.get(
  '/:id/users',
  validate(tenantIdSchema, 'params'),
  asyncHandler(tenantController.listTenantUsers)
);

export default router;
