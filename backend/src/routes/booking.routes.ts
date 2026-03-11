import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import {
  // Public
  getBookingByToken,
  handleReviewClick,
  handleNoReviewClick,
  // Internal
  handlePubSubReview,
  // Admin
  listBookings,
  createBooking,
  getBookingDetail,
  updateBooking,
  deleteBooking,
  manualSendGallery,
  updateReviewMatchStatus,
  getBookingStats,
} from '../controllers/booking.controller.js';

const router = Router();

// ===========================
// PUBLIC ROUTES (no auth required)
// ===========================

// Get booking page data by public token
router.get('/public/bookings/:token', getBookingByToken);

// Handle "Leave a Google review" click
router.post('/public/bookings/:token/actions/review-click', handleReviewClick);

// Handle "I don't want to leave a review" click
router.post('/public/bookings/:token/actions/no-review-click', handleNoReviewClick);

// ===========================
// INTERNAL ROUTES (Pub/Sub webhook)
// ===========================

// Google Pub/Sub push endpoint for new reviews
router.post('/internal/google/pubsub/reviews', handlePubSubReview);

// ===========================
// ADMIN ROUTES (authenticated)
// ===========================

// List all bookings
router.get('/bookings', authenticate, requireAdmin, listBookings);

// Get booking stats
router.get('/bookings/stats', authenticate, requireAdmin, getBookingStats);

// Create a new booking
router.post('/bookings', authenticate, requireAdmin, createBooking);

// Get booking detail
router.get('/bookings/:id', authenticate, requireAdmin, getBookingDetail);

// Update a booking
router.put('/bookings/:id', authenticate, requireAdmin, updateBooking);

// Delete a booking
router.delete('/bookings/:id', authenticate, requireAdmin, deleteBooking);

// Manually send gallery
router.post('/bookings/:id/send-gallery', authenticate, requireAdmin, manualSendGallery);

// Update review match status
router.patch('/bookings/review-matches/:matchId/status', authenticate, requireAdmin, updateReviewMatchStatus);

export default router;
