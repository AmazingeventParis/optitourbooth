import { Router, Request, Response } from 'express';
import { apiResponse } from '../utils/index.js';

// Import des routes
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import clientRoutes from './client.routes.js';
import produitRoutes from './produit.routes.js';
import tourneeRoutes from './tournee.routes.js';
import gpsRoutes from './gps.routes.js';
import vehiculeRoutes from './vehicule.routes.js';
import notificationRoutes from './notification.routes.js';

const router = Router();

// Route de santé
router.get('/health', (_req: Request, res: Response) => {
  apiResponse.success(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

// Route d'info API
router.get('/', (_req: Request, res: Response) => {
  apiResponse.success(res, {
    name: 'OptiTour Booth API',
    version: '1.0.0',
    description: 'API de gestion de tournées photobooth',
    documentation: '/api/docs',
    endpoints: {
      health: 'GET /api/health',
      auth: {
        login: 'POST /api/auth/login',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me',
        password: 'PUT /api/auth/password',
      },
      users: {
        list: 'GET /api/users',
        create: 'POST /api/users',
        get: 'GET /api/users/:id',
        update: 'PUT /api/users/:id',
        delete: 'DELETE /api/users/:id',
        chauffeurs: 'GET /api/users/chauffeurs',
      },
      clients: {
        list: 'GET /api/clients',
        create: 'POST /api/clients',
        get: 'GET /api/clients/:id',
        update: 'PUT /api/clients/:id',
        delete: 'DELETE /api/clients/:id',
        search: 'GET /api/clients/search?q=...',
        villes: 'GET /api/clients/villes',
        geocode: 'POST /api/clients/:id/geocode',
      },
      produits: {
        list: 'GET /api/produits',
        create: 'POST /api/produits',
        get: 'GET /api/produits/:id',
        update: 'PUT /api/produits/:id',
        delete: 'DELETE /api/produits/:id',
        actifs: 'GET /api/produits/actifs',
        options: {
          create: 'POST /api/produits/:id/options',
          update: 'PUT /api/produits/:id/options/:optionId',
          delete: 'DELETE /api/produits/:id/options/:optionId',
        },
      },
      tournees: {
        list: 'GET /api/tournees',
        create: 'POST /api/tournees',
        get: 'GET /api/tournees/:id',
        update: 'PUT /api/tournees/:id',
        delete: 'DELETE /api/tournees/:id',
        optimize: 'POST /api/tournees/:id/optimize',
        start: 'POST /api/tournees/:id/start',
        finish: 'POST /api/tournees/:id/finish',
        route: 'GET /api/tournees/:id/route',
        points: {
          add: 'POST /api/tournees/:id/points',
          update: 'PUT /api/tournees/:id/points/:pointId',
          delete: 'DELETE /api/tournees/:id/points/:pointId',
          reorder: 'PUT /api/tournees/:id/points/reorder',
        },
      },
      vehicules: {
        list: 'GET /api/vehicules',
        actifs: 'GET /api/vehicules/actifs',
        create: 'POST /api/vehicules',
        get: 'GET /api/vehicules/:id',
        update: 'PUT /api/vehicules/:id',
        delete: 'DELETE /api/vehicules/:id',
      },
      notifications: {
        vapidKey: 'GET /api/notifications/vapid-public-key',
        subscribe: 'POST /api/notifications/subscribe',
        unsubscribe: 'DELETE /api/notifications/unsubscribe',
      },
    },
  });
});

// Montage des routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/clients', clientRoutes);
router.use('/produits', produitRoutes);
router.use('/tournees', tourneeRoutes);
router.use('/gps', gpsRoutes);
router.use('/vehicules', vehiculeRoutes);
router.use('/notifications', notificationRoutes);

export default router;
