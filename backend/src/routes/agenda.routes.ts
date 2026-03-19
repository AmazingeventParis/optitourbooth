import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import * as agendaController from '../controllers/agenda.controller.js';

const router = Router();
router.use(authenticate);

// Allocations (immobilization blocks) - readable by all authenticated users
router.get('/allocations', agendaController.getAllocations);

// Stock availability per type per day
router.get('/stock', agendaController.getStock);

// Machine list grouped by type
router.get('/machines', agendaController.getMachines);

// Assign/reassign machine to event (admin only)
router.post('/assign-machine', requireAdmin, agendaController.assignMachine);

export default router;
