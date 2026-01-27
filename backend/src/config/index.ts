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

  // Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    dir: process.env.UPLOAD_DIR || './uploads',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
} as const;
