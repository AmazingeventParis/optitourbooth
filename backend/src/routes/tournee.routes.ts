import { Router } from 'express';
import multer from 'multer';
import { tourneeController } from '../controllers/tournee.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { validate, validateMultiple } from '../middlewares/validation.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  tourneeIdSchema,
  tourneeQuerySchema,
  createTourneeSchema,
  updateTourneeSchema,
  pointIdSchema,
  createPointSchema,
  updatePointSchema,
  reorderPointsSchema,
  movePointSchema,
  createIncidentSchema,
} from '../validators/tournee.validator.js';
import path from 'path';
import fs from 'fs';

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuration multer pour l'upload de fichiers Excel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Utilisez .xlsx, .xls ou .csv'));
    }
  },
});

// Configuration multer pour l'upload de photos
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per photo
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Utilisez JPEG, PNG ou WebP'));
    }
  },
});

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// ========== TOURNEES ==========

// Liste des tournées
router.get('/', validate(tourneeQuerySchema, 'query'), asyncHandler(tourneeController.list));

// Détails d'une tournée
router.get(
  '/:id',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.getById)
);

// Créer une tournée (admin)
router.post(
  '/',
  requireAdmin,
  validate(createTourneeSchema),
  asyncHandler(tourneeController.create)
);

// Modifier une tournée (admin)
router.put(
  '/:id',
  requireAdmin,
  validateMultiple({
    params: tourneeIdSchema,
    body: updateTourneeSchema,
  }),
  asyncHandler(tourneeController.update)
);

// Supprimer une tournée planifiée (admin)
router.delete(
  '/:id',
  requireAdmin,
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.delete)
);

// Dupliquer une tournée (admin)
router.post(
  '/:id/duplicate',
  requireAdmin,
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.duplicate)
);

// Obtenir les stats d'une tournée
router.get(
  '/:id/stats',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.getStats)
);

// Optimiser l'ordre des points (admin)
router.post(
  '/:id/optimize',
  requireAdmin,
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.optimize)
);

// Annuler une tournée (chauffeur ou admin)
router.post(
  '/:id/cancel',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.cancel)
);

// Démarrer une tournée (chauffeur ou admin)
router.post(
  '/:id/start',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.start)
);

// Terminer une tournée (chauffeur ou admin)
router.post(
  '/:id/finish',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.finish)
);

// Obtenir l'itinéraire calculé
router.get(
  '/:id/route',
  validate(tourneeIdSchema, 'params'),
  asyncHandler(tourneeController.getRoute)
);

// Prévisualiser l'import d'un fichier Excel sans tournée (admin)
router.post(
  '/import/preview',
  requireAdmin,
  upload.single('file'),
  asyncHandler(tourneeController.importPreviewGeneral)
);

// Prévisualiser l'import d'un fichier Excel pour une tournée spécifique (admin)
router.post(
  '/:id/import/preview',
  requireAdmin,
  validate(tourneeIdSchema, 'params'),
  upload.single('file'),
  asyncHandler(tourneeController.importPreview)
);

// Importer les points depuis un fichier Excel (admin)
router.post(
  '/:id/import',
  requireAdmin,
  validate(tourneeIdSchema, 'params'),
  upload.single('file'),
  asyncHandler(tourneeController.importPoints)
);

// ========== POINTS ==========

// Ajouter un point (admin)
router.post(
  '/:id/points',
  requireAdmin,
  validateMultiple({
    params: tourneeIdSchema,
    body: createPointSchema,
  }),
  asyncHandler(tourneeController.addPoint)
);

// Réordonner les points (admin)
router.put(
  '/:id/points/reorder',
  requireAdmin,
  validateMultiple({
    params: tourneeIdSchema,
    body: reorderPointsSchema,
  }),
  asyncHandler(tourneeController.reorderPoints)
);

// Modifier un point (admin ou chauffeur assigné)
router.put(
  '/:id/points/:pointId',
  validateMultiple({
    params: pointIdSchema,
    body: updatePointSchema,
  }),
  asyncHandler(tourneeController.updatePoint)
);

// Déplacer un point vers une autre tournée (admin)
router.put(
  '/:id/points/:pointId/move',
  requireAdmin,
  validateMultiple({
    params: pointIdSchema,
    body: movePointSchema,
  }),
  asyncHandler(tourneeController.movePoint)
);

// Supprimer un point (admin)
router.delete(
  '/:id/points/:pointId',
  requireAdmin,
  validate(pointIdSchema, 'params'),
  asyncHandler(tourneeController.deletePoint)
);

// ========== PHOTOS ==========

// Ajouter des photos à un point (chauffeur)
router.post(
  '/:id/points/:pointId/photos',
  validate(pointIdSchema, 'params'),
  photoUpload.array('photos', 10), // Max 10 photos
  asyncHandler(tourneeController.addPhotos)
);

// ========== INCIDENTS ==========

// Créer un incident pour un point (chauffeur)
router.post(
  '/:id/points/:pointId/incidents',
  validateMultiple({
    params: pointIdSchema,
    body: createIncidentSchema,
  }),
  asyncHandler(tourneeController.createIncident)
);

export default router;
