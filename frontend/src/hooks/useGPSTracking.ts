import { useEffect, useRef, useCallback, useState } from 'react';
import { socketService, PositionUpdate } from '@/services/socket.service';
import { gpsService } from '@/services/gps.service';

interface UseGPSTrackingOptions {
  enabled: boolean;
  intervalMs?: number; // How often to send position via socket (default: 10s)
  restBackupIntervalMs?: number; // How often to send via REST as backup (default: 30s)
  impersonatedChauffeurId?: string; // For admin impersonation mode
}

interface UseGPSTrackingReturn {
  isTracking: boolean;
  lastPosition: PositionUpdate | null;
  error: string | null;
  accuracy: number | null;
}

/**
 * Hook for GPS tracking for chauffeurs
 * - Watches GPS position continuously when enabled
 * - Sends position via Socket.io for real-time updates
 * - Falls back to REST API as backup
 */
export function useGPSTracking({
  enabled,
  intervalMs = 10000,
  restBackupIntervalMs = 30000,
  impersonatedChauffeurId,
}: UseGPSTrackingOptions): UseGPSTrackingReturn {
  const [isTracking, setIsTracking] = useState(false);
  const [lastPosition, setLastPosition] = useState<PositionUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const socketIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const lastSocketSendRef = useRef<number>(0);

  // Send position via Socket.io
  const sendPositionViaSocket = useCallback(() => {
    if (!lastPositionRef.current || !socketService.isConnected()) return;

    const pos = lastPositionRef.current;
    const positionData: PositionUpdate = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed ?? undefined,
      heading: pos.coords.heading ?? undefined,
      timestamp: pos.timestamp,
      impersonatedUserId: impersonatedChauffeurId, // Include if admin is impersonating
    };

    socketService.sendPosition(positionData);
    lastSocketSendRef.current = Date.now();
    setLastPosition(positionData);
  }, [impersonatedChauffeurId]);

  // Send position via REST API (backup)
  const sendPositionViaRest = useCallback(async () => {
    if (!lastPositionRef.current) return;

    try {
      await gpsService.sendPositionToServer();
    } catch (err) {
      console.error('[GPS] REST backup failed:', err);
    }
  }, []);

  // Start tracking
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('La géolocalisation n\'est pas supportée par ce navigateur');
      return;
    }

    setError(null);
    setIsTracking(true);

    // Watch position changes
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = position;
        setAccuracy(position.coords.accuracy);
        setError(null);

        // Update position state
        const positionData: PositionUpdate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed ?? undefined,
          heading: position.coords.heading ?? undefined,
          timestamp: position.timestamp,
        };
        setLastPosition(positionData);

        // Send immediately if enough time has passed
        const now = Date.now();
        if (now - lastSocketSendRef.current >= intervalMs) {
          sendPositionViaSocket();
        }
      },
      (err) => {
        console.error('[GPS] Error:', err);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError('Permission de géolocalisation refusée');
            break;
          case err.POSITION_UNAVAILABLE:
            setError('Position GPS indisponible');
            break;
          case err.TIMEOUT:
            setError('Délai de géolocalisation dépassé');
            break;
          default:
            setError('Erreur de géolocalisation');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );

    // Set up socket interval for regular updates
    socketIntervalRef.current = setInterval(() => {
      sendPositionViaSocket();
    }, intervalMs);

    // Set up REST backup interval
    restIntervalRef.current = setInterval(() => {
      sendPositionViaRest();
    }, restBackupIntervalMs);

    console.log('[GPS] Tracking started');
  }, [intervalMs, restBackupIntervalMs, sendPositionViaSocket, sendPositionViaRest]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (socketIntervalRef.current !== null) {
      clearInterval(socketIntervalRef.current);
      socketIntervalRef.current = null;
    }

    if (restIntervalRef.current !== null) {
      clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
    }

    lastPositionRef.current = null;
    setIsTracking(false);
    console.log('[GPS] Tracking stopped');
  }, []);

  // Effect to start/stop tracking based on enabled prop
  useEffect(() => {
    if (enabled) {
      startTracking();
    } else {
      stopTracking();
    }

    // Cleanup on unmount
    return () => {
      stopTracking();
    };
  }, [enabled, impersonatedChauffeurId, startTracking, stopTracking]);

  return {
    isTracking,
    lastPosition,
    error,
    accuracy,
  };
}
