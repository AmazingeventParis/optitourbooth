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

// Auto-optimize assignments for a period (admin only)
router.post('/optimize', requireAdmin, agendaController.optimizeAssignments);

// Check 4h margin before manual assignment
router.post('/check-margin', requireAdmin, agendaController.checkMargin);

// Validation des préparations depuis l'agenda
router.post('/validate-machine', requireAdmin, agendaController.validateMachine);
router.post('/validate-type', requireAdmin, agendaController.validateType);
router.post('/unlock-machine', requireAdmin, agendaController.unlockMachine);

export default router;
