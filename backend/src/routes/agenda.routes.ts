import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import * as agendaController from '../controllers/agenda.controller.js';

const router = Router();
router.use(authenticate);

// Allocations (immobilization blocks) - readable by all authenticated users
router.get('/allocations', agendaController.getAllocations);

// Stock availability per type per day
router.get('/stock', agendaController.getStock);

// Machine list grouped by type
router.get('/machines', agendaController.getMachines);

export default router;
