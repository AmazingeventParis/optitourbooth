import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import {
  // Public
  getBookingByToken,
  handleStarRating,
  handleReviewClick,
  handleNoReviewClick,
  // Internal
  handlePubSubReview,
  // Admin
  listBookings,
  listCalendarEvents,
  createBooking,
  createBookingFromEvent,
  getBookingDetail,
  updateBooking,
  deleteBooking,
  manualSendGallery,
  sendLinkEmail,
  resetGalleryUrls,
  resetAllRatings,
  updateReviewMatchStatus,
  getBookingStats,
} from '../controllers/booking.controller.js';

const router = Router();

// ===========================
// PUBLIC ROUTES (no auth required)
// ===========================

// Get booking page data by public token
router.get('/public/bookings/:token', getBookingByToken);

// Handle star rating (1-5)
router.post('/public/bookings/:token/actions/rate', handleStarRating);

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

// List calendar events with booking status
router.get('/bookings/calendar-events', authenticate, requireAdmin, listCalendarEvents);

// Create a new booking
router.post('/bookings', authenticate, requireAdmin, createBooking);

// Create booking from Google Calendar event
router.post('/bookings/from-event', authenticate, requireAdmin, createBookingFromEvent);

// Get booking detail
router.get('/bookings/:id', authenticate, requireAdmin, getBookingDetail);

// Update a booking
router.put('/bookings/:id', authenticate, requireAdmin, updateBooking);

// Delete a booking
router.delete('/bookings/:id', authenticate, requireAdmin, deleteBooking);

// Manually send gallery
router.post('/bookings/:id/send-gallery', authenticate, requireAdmin, manualSendGallery);

// Send review link email to customer
router.post('/bookings/:id/send-link-email', authenticate, requireAdmin, sendLinkEmail);

// Reset all gallery URLs (to force Drive folder recreation in monthly subfolders)
router.post('/bookings/reset-gallery-urls', authenticate, requireAdmin, resetGalleryUrls);

// Reset all ratings and revert associated statuses
router.post('/bookings/reset-ratings', authenticate, requireAdmin, resetAllRatings);

// Update review match status
router.patch('/bookings/review-matches/:matchId/status', authenticate, requireAdmin, updateReviewMatchStatus);

export default router;
