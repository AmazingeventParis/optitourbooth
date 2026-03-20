import { Router } from 'express';
import * as controller from '../controllers/pendingPoint.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { apiKeyAuth } from '../middlewares/apiKey.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// API externe (Google Apps Script) - authentification par clé API
router.post('/', apiKeyAuth, asyncHandler(controller.createPendingPoints));

// API interne (Frontend) - authentification JWT
router.post('/manual', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.createManualPendingPoint));
router.get('/', authenticate, requireRole('preparateur', 'admin', 'warehouse', 'superadmin'), asyncHandler(controller.listPendingPoints));
router.get('/calendar-events', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(controller.listCalendarEvents));
router.delete('/:id', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.deletePendingPoint));
router.patch('/:id/dispatch', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.markDispatched));
router.patch('/:id/use-in-preparation', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(controller.markUsedInPreparation));
router.patch('/:id/ignore-suggestion', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(controller.ignoreSuggestion));
router.patch('/:id/restore-suggestion', authenticate, requireRole('preparateur', 'warehouse', 'admin', 'superadmin'), asyncHandler(controller.restoreSuggestion));
router.patch('/:id', authenticate, requireRole('admin', 'warehouse', 'superadmin'), asyncHandler(controller.updatePendingPoint));

// Sync manuelle Google Calendar
router.post('/sync-google-calendar', authenticate, requireRole('admin', 'superadmin'), asyncHandler(controller.syncGoogleCalendar));

export default router;
