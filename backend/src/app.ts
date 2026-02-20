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
import { initializeSocket } from './config/socket.js';
import { notFoundHandler, errorHandler } from './middlewares/index.js';
import routes from './routes/index.js';
import { autoUpdatePreparationStatuses } from './controllers/preparation.controller.js';

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

      // Keep-alive: ping self every 10 min to prevent Render free tier sleep
      if (!config.isDev && process.env.RENDER_EXTERNAL_URL) {
        const url = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
        setInterval(() => {
          fetch(url).catch(() => {});
        }, 10 * 60 * 1000);
        console.log(`🏓 Keep-alive enabled: pinging ${url} every 10 min`);
      }

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
