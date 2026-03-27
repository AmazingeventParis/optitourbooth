import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import * as billingController from '../controllers/billing.controller.js';

const router = Router();
router.use(authenticate);

// Configs (rate grids)
router.get('/configs', requireAdmin, billingController.getConfigs);
router.put('/configs/:userId', requireAdmin, billingController.upsertConfig);

// Entries (history)
router.get('/entries', requireAdmin, billingController.getEntries);
router.get('/entries/by-points', requireAdmin, billingController.getEntriesByPoints);
router.post('/entries', requireAdmin, billingController.createEntry);
router.patch('/entries/:id/paid', requireAdmin, billingController.togglePaid);
router.put('/entries/point-hf/:pointId', requireAdmin, billingController.upsertPointHfEntry);
router.delete('/entries/point-hf/:pointId', requireAdmin, billingController.deletePointHfEntry);
router.delete('/entries/:id', requireAdmin, billingController.deleteEntry);

// Recovery (récupération)
router.get('/recovery', requireAdmin, billingController.getRecoveryEntries);
router.post('/recovery/solde', requireAdmin, billingController.createRecoverySolde);

// Auto-compute
router.post('/compute', requireAdmin, billingController.computeEntries);

export default router;
