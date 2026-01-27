import { Router } from 'express';
import { gpsController } from '../controllers/gps.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Update position (chauffeur)
router.post('/position', asyncHandler(gpsController.updatePosition));

// Get all positions (admin only)
router.get('/positions', requireAdmin, asyncHandler(gpsController.getAllPositions));

// Get specific chauffeur position (admin only)
router.get('/position/:chauffeurId', requireAdmin, asyncHandler(gpsController.getPosition));

// Get position history (admin only)
router.get('/history/:chauffeurId', requireAdmin, asyncHandler(gpsController.getHistory));

export default router;
