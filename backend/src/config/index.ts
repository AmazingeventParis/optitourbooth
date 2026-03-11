// Configuration centralisée
export * from './database.js';
export * from './redis.js';
export * from './socket.js';

// Variables d'environnement typées
export const config = {
  // Environnement
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Serveur
  port: parseInt(process.env.PORT || '3000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3000',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_jwt_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  // Services externes
  osrm: {
    baseUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',
  },
  nominatim: {
    url: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  },
  tomtom: {
    apiKey: process.env.TOMTOM_API_KEY || '',
  },
  // VROOM - Optimisation de tournées avec contraintes (time windows, service times)
  // Option 1: VROOM local via Docker: docker run -p 3000:3000 vroomvrp/vroom-express
  // Option 2: OpenRouteService API (gratuit avec clé API)
  vroom: {
    baseUrl: process.env.VROOM_URL || '', // Ex: http://localhost:3000
    enabled: process.env.VROOM_ENABLED === 'true',
  },
  openRouteService: {
    apiKey: process.env.ORS_API_KEY || '', // Clé API gratuite sur openrouteservice.org
  },

  // Web Push (VAPID)
  webPush: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@optitour.fr',
  },

  // Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    dir: process.env.UPLOAD_DIR || './uploads',
  },

  // API Keys (machine-to-machine)
  apiKeys: {
    google: process.env.API_KEY_GOOGLE || '',
  },

  // Google Calendar sync
  googleCalendar: {
    serviceAccountBase64: process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 || '',
    calendarIds: (process.env.GOOGLE_CALENDAR_IDS || process.env.GOOGLE_CALENDAR_ID || '').split(',').map(s => s.trim()).filter(Boolean),
    syncEnabled: process.env.GOOGLE_CALENDAR_SYNC_ENABLED === 'true',
    syncIntervalMinutes: parseInt(process.env.GOOGLE_CALENDAR_SYNC_INTERVAL || '15', 10),
    syncDaysAhead: parseInt(process.env.GOOGLE_CALENDAR_SYNC_DAYS_AHEAD || '30', 10),
  },

  // Google Business Profile (Review system)
  googleBusiness: {
    oauthClientId: process.env.GOOGLE_BP_CLIENT_ID || '',
    oauthClientSecret: process.env.GOOGLE_BP_CLIENT_SECRET || '',
    oauthRefreshToken: process.env.GOOGLE_BP_REFRESH_TOKEN || '',
    accountId: process.env.GOOGLE_BP_ACCOUNT_ID || '',
    locationId: process.env.GOOGLE_BP_LOCATION_ID || '',
    defaultReviewUrl: process.env.GOOGLE_DEFAULT_REVIEW_URL || '',
    pubsubProjectId: process.env.GOOGLE_PUBSUB_PROJECT_ID || '',
    pubsubTopicName: process.env.GOOGLE_PUBSUB_TOPIC_NAME || 'gbp-reviews',
  },

  // Review system
  reviewSystem: {
    galleryDelayHours: parseInt(process.env.GALLERY_DELAY_HOURS || '24', 10),
    matchingWindowMinutes: parseInt(process.env.MATCHING_WINDOW_MINUTES || '60', 10),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:5173',
  },

  // CORS
  cors: {
    origin: [
      ...(process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()),
      // Capacitor native app origins
      'https://localhost',
      'capacitor://localhost',
      'http://localhost',
    ],
  },
} as const;
