import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';

// In-memory store for real-time positions (in production, use Redis)
const positionsCache = new Map<string, {
  chauffeurId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
  updatedAt: Date;
}>();

export const gpsController = {
  /**
   * POST /api/gps/position
   * Update chauffeur position
   */
  async updatePosition(req: Request, res: Response): Promise<void> {
    const chauffeurId = req.user!.id;
    const { latitude, longitude, accuracy, speed, heading, timestamp } = req.body;

    if (!latitude || !longitude) {
      apiResponse.badRequest(res, 'Latitude et longitude requises');
      return;
    }

    // Store in memory cache
    positionsCache.set(chauffeurId, {
      chauffeurId,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      timestamp: timestamp || Date.now(),
      updatedAt: new Date(),
    });

    // Optionally store in database for history
    try {
      await prisma.position.create({
        data: {
          chauffeurId,
          latitude,
          longitude,
          accuracy,
          speed,
          heading,
          timestamp: new Date(timestamp || Date.now()),
        },
      });
    } catch (error) {
      // Log but don't fail - position history is optional
      console.error('Failed to store position history:', error);
    }

    apiResponse.success(res, { received: true });
  },

  /**
   * GET /api/gps/positions
   * Get all current chauffeur positions (admin only)
   */
  async getAllPositions(req: Request, res: Response): Promise<void> {
    // Get chauffeurs with their info
    const chauffeurs = await prisma.user.findMany({
      where: {
        OR: [
          { roles: { has: 'chauffeur' } },
          { roles: { has: 'admin' } },
        ],
        actif: true,
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        telephone: true,
      },
    });

    // Combine with position data
    const positions = chauffeurs.map((chauffeur) => {
      const position = positionsCache.get(chauffeur.id);
      const isOnline = position && (Date.now() - position.updatedAt.getTime()) < 5 * 60 * 1000; // 5 min timeout

      return {
        chauffeurId: chauffeur.id,
        chauffeur,
        latitude: position?.latitude,
        longitude: position?.longitude,
        accuracy: position?.accuracy,
        speed: position?.speed,
        heading: position?.heading,
        timestamp: position?.timestamp,
        isOnline,
      };
    });

    apiResponse.success(res, positions);
  },

  /**
   * GET /api/gps/position/:chauffeurId
   * Get specific chauffeur position (admin only)
   */
  async getPosition(req: Request, res: Response): Promise<void> {
    const chauffeurId = req.params.chauffeurId as string;

    const chauffeur = await prisma.user.findUnique({
      where: { id: chauffeurId },
      select: {
        id: true,
        nom: true,
        prenom: true,
        telephone: true,
      },
    });

    if (!chauffeur) {
      apiResponse.notFound(res, 'Chauffeur non trouvé');
      return;
    }

    const position = positionsCache.get(chauffeurId);
    const isOnline = position && (Date.now() - position.updatedAt.getTime()) < 5 * 60 * 1000;

    apiResponse.success(res, {
      chauffeurId,
      chauffeur,
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
      speed: position?.speed,
      heading: position?.heading,
      timestamp: position?.timestamp,
      isOnline,
    });
  },

  /**
   * GET /api/gps/history/:chauffeurId
   * Get position history for a chauffeur (admin only)
   */
  async getHistory(req: Request, res: Response): Promise<void> {
    const chauffeurId = req.params.chauffeurId as string;
    const { from, to, limit = '100' } = req.query;

    const where: {
      chauffeurId: string;
      timestamp?: { gte?: Date; lte?: Date };
    } = {
      chauffeurId,
    };

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from as string);
      if (to) where.timestamp.lte = new Date(to as string);
    }

    const history = await prisma.position.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
    });

    apiResponse.success(res, history);
  },
};
