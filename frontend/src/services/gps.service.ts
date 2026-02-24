import api from './api';
import { Position } from '@/types';

class GPSService {
  private watchId: number | null = null;
  private isTracking = false;
  private lastPosition: GeolocationPosition | null = null;
  private sendInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start tracking GPS position
   */
  startTracking(onPositionUpdate?: (position: Position) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      if (this.isTracking) {
        resolve();
        return;
      }

      this.isTracking = true;

      // Watch position changes
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          this.lastPosition = position;

          const positionData: Position = {
            chauffeurId: '', // Will be set by server from auth token
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || undefined,
            heading: position.coords.heading || undefined,
            timestamp: position.timestamp,
          };

          if (onPositionUpdate) {
            onPositionUpdate(positionData);
          }
        },
        (error) => {
          console.error('GPS Error:', error);
          if (!this.isTracking) {
            reject(error);
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      );

      // Send position to server every 30 seconds
      this.sendInterval = setInterval(() => {
        this.sendPositionToServer();
      }, 30000);

      resolve();
    });
  }

  /**
   * Stop tracking GPS position
   */
  stopTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    this.isTracking = false;
    this.lastPosition = null;
  }

  /**
   * Get current position once
   */
  getCurrentPosition(): Promise<Position> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            chauffeurId: '',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || undefined,
            heading: position.coords.heading || undefined,
            timestamp: position.timestamp,
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  /**
   * Send current position to server
   */
  async sendPositionToServer(): Promise<void> {
    if (!this.lastPosition) return;

    try {
      await api.post('/gps/position', {
        latitude: this.lastPosition.coords.latitude,
        longitude: this.lastPosition.coords.longitude,
        accuracy: this.lastPosition.coords.accuracy,
        speed: this.lastPosition.coords.speed,
        heading: this.lastPosition.coords.heading,
        timestamp: this.lastPosition.timestamp,
      });
    } catch (error) {
      console.error('Failed to send position to server:', error);
    }
  }

  /**
   * Send a batch of positions to server
   */
  async sendBatchPositions(positions: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    timestamp: number;
  }>): Promise<void> {
    if (positions.length === 0) return;

    try {
      await api.post('/gps/positions/batch', { positions });
    } catch (error) {
      console.error('Failed to send batch positions to server:', error);
      throw error;
    }
  }

  /**
   * Check if currently tracking
   */
  isCurrentlyTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Get last known position
   */
  getLastPosition(): GeolocationPosition | null {
    return this.lastPosition;
  }
}

export const gpsService = new GPSService();
