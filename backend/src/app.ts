import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { config, connectDatabase, disconnectDatabase } from './config/index.js';
import { disconnectRedis, redis } from './config/redis.js';
import { startGoogleCalendarSync, stopGoogleCalendarSync } from './services/googleCalendar.service.js';
import { startDriveFolderSync, stopDriveFolderSync } from './services/googleDrive.service.js';
import { initializeSocket } from './config/socket.js';
import { notFoundHandler, errorHandler } from './middlewares/index.js';
import routes from './routes/index.js';
import { autoUpdatePreparationStatuses } from './controllers/preparation.controller.js';
import { initializeQueues } from './config/queue.js';
import { processOverdueDispatches } from './services/galleryDispatch.service.js';
import { checkAndPoll, isReviewPollingConfigured } from './services/reviewPolling.service.js';
import { startGalleryWorker, stopGalleryWorker } from './workers/galleryWorker.js';
import { startCrmSync, stopCrmSync } from './services/crmSync.service.js';

// Créer l'application Express
const app = express();
const httpServer = createServer(app);

// ===========================================
// Middlewares de sécurité et utilitaires
// ===========================================

// Helmet pour la sécurité des headers HTTP
app.use(
  helmet({
    contentSecurityPolicy: false, // Désactivé pour permettre le chargement des images
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Permettre le chargement cross-origin des images
  })
);

// CORS
app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Compression des réponses
app.use(compression());

// Parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global (1000 requêtes par minute par IP en dev)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.isDev ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Trop de requêtes, veuillez réessayer plus tard',
    },
  },
});
app.use(limiter);

// Logging des requêtes en développement
if (config.isDev) {
  app.use((req, _res, next) => {
    console.log(`📡 ${req.method} ${req.path}`);
    next();
  });
}

// ===========================================
// Static files (uploads)
// ===========================================
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir));

// ===========================================
// Routes
// ===========================================

// Routes API
app.use('/api', routes);

// Route 404
app.use(notFoundHandler);

// Gestion des erreurs globales
app.use(errorHandler);

// ===========================================
// Démarrage du serveur
// ===========================================

async function startServer(): Promise<void> {
  try {
    // Connexion à la base de données
    await connectDatabase();

    // Flush Redis tournees cache (fix stale data)
    try {
      const keys = await redis.keys('tournees:*');
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`🧹 Flushed ${keys.length} stale tournees cache keys`);
      }
    } catch {
      // Redis might not be connected yet
    }

    // Initialiser Socket.io
    initializeSocket(httpServer);

    // Démarrer le serveur HTTP
    httpServer.listen(config.port, () => {
      console.log('');
      console.log('🚀 =====================================');
      console.log('   OptiTour Booth API');
      console.log('🚀 =====================================');
      console.log(`📡 Serveur: http://localhost:${config.port}`);
      console.log(`🔧 Environnement: ${config.nodeEnv}`);
      console.log(`📚 API: http://localhost:${config.port}/api`);
      console.log(`❤️  Health: http://localhost:${config.port}/api/health`);
      console.log('🚀 =====================================');
      console.log('');

      // Démarrer la sync Google Calendar
      startGoogleCalendarSync();

      // Démarrer le scan Drive (matching dossiers photos)
      startDriveFolderSync();

      // Initialize BullMQ queues and worker for gallery dispatch
      initializeQueues();
      startGalleryWorker();

      // CRON: Poll overdue gallery dispatches every 5 minutes (fallback for BullMQ)
      setInterval(async () => {
        try {
          await processOverdueDispatches();
        } catch (error) {
          console.error('[CRON] Gallery dispatch poll error:', error);
        }
      }, 5 * 60 * 1000);
      console.log('⏰ CRON: Gallery dispatch poll every 5 min');

      // CRON: Check for pending review clicks every 5 min
      // If someone clicked "Leave a review", starts active polling (every 1 min)
      // Otherwise costs nothing (just a DB query)
      if (isReviewPollingConfigured()) {
        setInterval(async () => {
          try {
            await checkAndPoll();
          } catch (error) {
            console.error('[CRON] Review check error:', error);
          }
        }, 5 * 60 * 1000);
        console.log('⏰ CRON: Review polling ready (activates on review-click, 1 min interval)');
      } else {
        console.log('⚠️  Google Places review polling not configured (GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID_*)');
      }

      // Keep-alive: ping self every 10 min to prevent Render free tier sleep
      if (!config.isDev && process.env.RENDER_EXTERNAL_URL) {
        const url = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
        setInterval(() => {
          fetch(url).catch(() => {});
        }, 10 * 60 * 1000);
        console.log(`🏓 Keep-alive enabled: pinging ${url} every 10 min`);
      }

      // CRON: Sync CRM emails into bookings every hour
      startCrmSync();

      // CRON: Auto-update preparation statuses every 5 minutes
      setInterval(async () => {
        try {
          await autoUpdatePreparationStatuses();
          console.log('[CRON] Auto-prep statuses updated');
        } catch (error) {
          console.error('[CRON] Auto-prep error:', error);
        }
      }, 5 * 60 * 1000); // 5 minutes
      console.log('⏰ CRON: Auto-prep statuses every 5 min');
    });
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    process.exit(1);
  }
}

// ===========================================
// Gestion de l'arrêt propre
// ===========================================

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n📴 Signal ${signal} reçu, arrêt en cours...`);

  // Fermer le serveur HTTP
  httpServer.close(() => {
    console.log('🔌 Serveur HTTP fermé');
  });

  // Arrêter les tâches planifiées
  stopGoogleCalendarSync();
  stopDriveFolderSync();
  stopGalleryWorker();
  stopCrmSync();

  // Fermer les connexions
  await disconnectDatabase();
  await disconnectRedis();

  console.log('👋 Arrêt terminé');
  process.exit(0);
}

// Écouter les signaux d'arrêt
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Gérer les erreurs non capturées
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

// Démarrer le serveur
startServer();

export { app, httpServer };
