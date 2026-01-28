import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/authStore';

// Types pour les événements Socket.io
export interface PositionUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
}

export interface ChauffeurPosition extends PositionUpdate {
  chauffeurId: string;
}

export interface PointStatusUpdate {
  pointId: string;
  tourneeId: string;
  statut: string;
  timestamp: number;
}

export interface IncidentAlert {
  chauffeurId: string;
  pointId: string;
  tourneeId: string;
  type: string;
  description: string;
  timestamp: number;
}

export interface TourneeUpdate {
  action: 'point_added' | 'point_removed';
  pointId: string;
}

type SocketEventCallback = (...args: unknown[]) => void;

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<SocketEventCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnecting = false;

  /**
   * Connect to the Socket.io server with JWT authentication
   */
  connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use provided token or get from auth store
      const authToken = token || useAuthStore.getState().token;

      if (!authToken) {
        reject(new Error('No authentication token available'));
        return;
      }

      // Already connected
      if (this.socket?.connected) {
        resolve();
        return;
      }

      // Already connecting
      if (this.isConnecting) {
        // Wait for connection
        const checkConnection = setInterval(() => {
          if (this.socket?.connected) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);
        return;
      }

      this.isConnecting = true;

      // Get Socket URL from environment
      // VITE_API_URL peut être: "/api" (local) ou "https://xxx.onrender.com/api" (production)
      const apiUrl = import.meta.env.VITE_API_URL || '/api';

      let socketUrl: string;
      if (apiUrl.startsWith('http')) {
        // Production: URL complète, retirer le path /api
        socketUrl = apiUrl.replace(/\/api\/?$/, '');
      } else {
        // Local: utiliser l'URL relative (sera proxy par Vite)
        socketUrl = '';
      }

      this.socket = io(socketUrl, {
        auth: { token: authToken },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });

      this.socket.on('connect', () => {
        console.log('[Socket] Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error.message);
        this.reconnectAttempts++;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.isConnecting = false;
          reject(new Error('Failed to connect to socket server'));
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
        if (reason === 'io server disconnect') {
          // Server disconnected us, try to reconnect
          this.socket?.connect();
        }
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
        this.reconnectAttempts = 0;
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('[Socket] Reconnection error:', error.message);
      });

      // Re-attach all listeners after reconnection
      this.socket.on('reconnect', () => {
        this.reattachListeners();
      });
    });
  }

  /**
   * Disconnect from the Socket.io server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners.clear();
    this.isConnecting = false;
    console.log('[Socket] Disconnected and cleaned up');
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Emit an event to the server
   */
  emit<T = unknown>(event: string, data: T): void {
    if (!this.socket?.connected) {
      console.warn('[Socket] Cannot emit, not connected');
      return;
    }
    this.socket.emit(event, data);
  }

  /**
   * Listen for an event from the server
   */
  on<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as SocketEventCallback);

    if (this.socket) {
      this.socket.on(event, callback as SocketEventCallback);
    }
  }

  /**
   * Remove a listener for an event
   */
  off<T = unknown>(event: string, callback: (data: T) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback as SocketEventCallback);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }

    if (this.socket) {
      this.socket.off(event, callback as SocketEventCallback);
    }
  }

  /**
   * Remove all listeners for an event
   */
  offAll(event: string): void {
    this.listeners.delete(event);
    if (this.socket) {
      this.socket.off(event);
    }
  }

  /**
   * Re-attach all listeners after reconnection
   */
  private reattachListeners(): void {
    if (!this.socket) return;

    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((callback) => {
        this.socket!.on(event, callback);
      });
    });
  }

  /**
   * Request all chauffeur positions (admin only)
   */
  requestAllPositions(): void {
    this.emit('positions:getAll', {});
  }

  /**
   * Send position update (chauffeur only)
   */
  sendPosition(position: PositionUpdate): void {
    this.emit('position:update', position);
  }

  /**
   * Send point status update (chauffeur only)
   */
  sendPointStatus(data: PointStatusUpdate): void {
    this.emit('point:status', data);
  }

  /**
   * Report an incident (chauffeur only)
   */
  reportIncident(data: Omit<IncidentAlert, 'chauffeurId'>): void {
    this.emit('incident:report', data);
  }
}

// Singleton instance
export const socketService = new SocketService();
