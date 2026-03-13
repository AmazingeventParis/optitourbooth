import api, { ApiResponse } from './api';

export interface Booking {
  id: string;
  publicToken: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  eventDate: string;
  galleryUrl: string | null;
  googleReviewUrl: string | null;
  businessAccountId: string | null;
  businessLocationId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  publicUrl?: string;
  _count?: {
    events: number;
    reviewMatches: number;
    galleryDispatches: number;
  };
}

export interface BookingEvent {
  id: string;
  bookingId: string;
  eventType: string;
  occurredAt: string;
  sessionId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  referer: string | null;
  metadataJson: Record<string, unknown> | null;
}

export interface ReviewMatch {
  id: string;
  bookingId: string;
  googleReviewName: string | null;
  googleReviewId: string | null;
  googleReviewerDisplayName: string | null;
  googleReviewCreateTime: string | null;
  googleReviewUpdateTime: string | null;
  matchScore: number;
  matchStatus: string;
  matchedAt: string | null;
  rawPayloadJson: Record<string, unknown> | null;
}

export interface GalleryDispatch {
  id: string;
  bookingId: string;
  dispatchType: string;
  scheduledFor: string;
  sentAt: string | null;
  channel: string;
  deliveryStatus: string;
  providerMessageId: string | null;
  payloadJson: Record<string, unknown> | null;
}

export interface BookingDetail extends Booking {
  events: BookingEvent[];
  reviewMatches: ReviewMatch[];
  galleryDispatches: GalleryDispatch[];
}

export interface BookingStats {
  total: number;
  byStatus: Record<string, number>;
  recentEvents7d: number;
  googleBusinessConfigured: boolean;
}

export interface CalendarEvent {
  googleEventId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  produitNom: string | null;
  adresse: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  notes: string | null;
  booking: {
    id: string;
    publicToken: string;
    publicUrl: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    senderBrand: string | null;
    rating: number | null;
    galleryUrl: string | null;
    googleReviewUrl: string | null;
    status: string;
    emailSentAt: string | null;
    photosNotUnloaded: boolean;
    createdAt: string;
    _count: { events: number; reviewMatches: number; galleryDispatches: number };
  } | null;
}

export interface CalendarEventsResponse {
  upcoming: CalendarEvent[];
  past: CalendarEvent[];
}

export const bookingsService = {
  async list(params?: { page?: number; limit?: number; status?: string; search?: string }) {
    const response = await api.get<ApiResponse<Booking[]>>('/bookings', { params });
    return response.data;
  },

  async getStats() {
    const response = await api.get<ApiResponse<BookingStats>>('/bookings/stats');
    return response.data.data;
  },

  async getById(id: string) {
    const response = await api.get<ApiResponse<BookingDetail>>(`/bookings/${id}`);
    return response.data.data;
  },

  async create(data: {
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    eventDate: string;
    galleryUrl?: string;
    googleReviewUrl?: string;
  }) {
    const response = await api.post<ApiResponse<Booking & { publicUrl: string }>>('/bookings', data);
    return response.data.data;
  },

  async update(id: string, data: Partial<Booking>) {
    const response = await api.put<ApiResponse<Booking>>(`/bookings/${id}`, data);
    return response.data.data;
  },

  async delete(id: string) {
    await api.delete(`/bookings/${id}`);
  },

  async sendGallery(id: string, brand?: 'SHOOTNBOX' | 'SMAKK') {
    const response = await api.post<ApiResponse<{ message: string }>>(`/bookings/${id}/send-gallery`, brand ? { brand } : {});
    return response.data.data;
  },

  async updateMatchStatus(matchId: string, status: 'matched' | 'rejected') {
    const response = await api.patch<ApiResponse<{ message: string }>>(
      `/bookings/review-matches/${matchId}/status`,
      { status }
    );
    return response.data.data;
  },

  async getCalendarEvents() {
    const response = await api.get<ApiResponse<CalendarEventsResponse>>('/bookings/calendar-events');
    return response.data.data;
  },

  async createFromEvent(data: {
    googleEventId: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    eventDate: string;
    eventEndDate?: string;
    produitNom?: string;
    galleryUrl?: string;
    googleReviewUrl?: string;
  }) {
    const response = await api.post<ApiResponse<Booking & { publicUrl: string }>>('/bookings/from-event', data);
    return response.data.data;
  },

  async sendLinkEmail(id: string, email: string, senderBrand?: string) {
    const response = await api.post<ApiResponse<{ message: string; publicUrl: string }>>(`/bookings/${id}/send-link-email`, { email, senderBrand });
    return response.data.data;
  },
};
