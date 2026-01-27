import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { cacheHelpers } from './redis.js';

// Types pour les événements Socket.io
interface PositionUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
}

interface PointStatusUpdate {
  pointId: string;
  tourneeId: string;
  statut: string;
  timestamp: number;
}

interface IncidentReport {
  pointId: string;
  tourneeId: string;
  type: string;
  description: string;
  timestamp: number;
}

interface JwtPayload {
  userId: string;
  role: string;
}

// Instance Socket.io
let io: Server | null = null;

export function initializeSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Middleware d'authentification
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Token manquant'));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'dev_secret'
      ) as JwtPayload;

      // Stocker les infos utilisateur dans le socket
      socket.data.userId = decoded.userId;
      socket.data.role = decoded.role;

      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  // Gestion des connexions
  io.on('connection', (socket: Socket) => {
    const { userId, role } = socket.data;
    console.log(`🔌 Socket connecté: ${userId} (${role})`);

    // Rejoindre les rooms appropriées
    socket.join(`user:${userId}`);
    if (role === 'admin') {
      socket.join('admins');
    } else if (role === 'chauffeur') {
      socket.join('chauffeurs');
    }

    // === ÉVÉNEMENTS CHAUFFEUR ===

    // Mise à jour de position GPS
    socket.on('position:update', async (data: PositionUpdate) => {
      if (role !== 'chauffeur') return;

      // Stocker dans Redis pour accès rapide
      await cacheHelpers.setPosition(userId, {
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: data.timestamp,
      });

      // Broadcast aux admins
      io?.to('admins').emit('chauffeur:position', {
        chauffeurId: userId,
        ...data,
      });
    });

    // Changement de statut d'un point
    socket.on('point:status', async (data: PointStatusUpdate) => {
      if (role !== 'chauffeur') return;

      // Broadcast aux admins
      io?.to('admins').emit('point:updated', {
        chauffeurId: userId,
        ...data,
      });

      // Notifier aussi le chauffeur concerné (confirmation)
      socket.emit('point:status:confirmed', data);
    });

    // Déclaration d'incident
    socket.on('incident:report', async (data: IncidentReport) => {
      if (role !== 'chauffeur') return;

      // Broadcast aux admins (alerte)
      io?.to('admins').emit('incident:alert', {
        chauffeurId: userId,
        ...data,
      });

      socket.emit('incident:received', { success: true });
    });

    // === ÉVÉNEMENTS ADMIN ===

    // Réassignation d'un point
    socket.on('point:reassign', async (data: { pointId: string; newChauffeurId: string; oldChauffeurId: string }) => {
      if (role !== 'admin') return;

      // Notifier l'ancien chauffeur
      io?.to(`user:${data.oldChauffeurId}`).emit('tournee:updated', {
        action: 'point_removed',
        pointId: data.pointId,
      });

      // Notifier le nouveau chauffeur
      io?.to(`user:${data.newChauffeurId}`).emit('tournee:updated', {
        action: 'point_added',
        pointId: data.pointId,
      });

      // Confirmer à l'admin
      socket.emit('point:reassign:confirmed', data);
    });

    // Demande de toutes les positions
    socket.on('positions:getAll', async () => {
      if (role !== 'admin') return;

      const positions = await cacheHelpers.getAllPositions();
      socket.emit('positions:all', positions);
    });

    // Déconnexion
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket déconnecté: ${userId} (${reason})`);
    });
  });

  console.log('✅ Socket.io initialisé');
  return io;
}

// Fonction pour émettre depuis n'importe où dans l'application
export function getIO(): Server | null {
  return io;
}

// Helpers pour émettre des événements
export const socketEmit = {
  // Émettre à un utilisateur spécifique
  toUser(userId: string, event: string, data: unknown): void {
    io?.to(`user:${userId}`).emit(event, data);
  },

  // Émettre à tous les admins
  toAdmins(event: string, data: unknown): void {
    io?.to('admins').emit(event, data);
  },

  // Émettre à tous les chauffeurs
  toChauffeurs(event: string, data: unknown): void {
    io?.to('chauffeurs').emit(event, data);
  },

  // Émettre à tout le monde
  toAll(event: string, data: unknown): void {
    io?.emit(event, data);
  },
};
