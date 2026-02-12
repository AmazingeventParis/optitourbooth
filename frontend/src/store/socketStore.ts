import { create } from 'zustand';
import { ChauffeurPosition } from '@/services/socket.service';

interface SocketState {
  // Connection state
  isConnected: boolean;

  // Chauffeur positions (keyed by chauffeurId)
  chauffeurPositions: Map<string, ChauffeurPosition>;

  // Actions
  setConnected: (connected: boolean) => void;
  updateChauffeurPosition: (chauffeurId: string, position: ChauffeurPosition) => void;
  removeChauffeurPosition: (chauffeurId: string) => void;
  clearAllPositions: () => void;
  setAllPositions: (positions: ChauffeurPosition[] | Record<string, any>) => void;
}

// Timeout for stale positions (5 minutes)
const POSITION_STALE_TIMEOUT = 5 * 60 * 1000;

export const useSocketStore = create<SocketState>((set, get) => ({
  isConnected: false,
  chauffeurPositions: new Map(),

  setConnected: (connected) => set({ isConnected: connected }),

  updateChauffeurPosition: (chauffeurId, position) => {
    const { chauffeurPositions } = get();
    const newPositions = new Map(chauffeurPositions);
    newPositions.set(chauffeurId, {
      ...position,
      chauffeurId,
    });
    set({ chauffeurPositions: newPositions });
  },

  removeChauffeurPosition: (chauffeurId) => {
    const { chauffeurPositions } = get();
    const newPositions = new Map(chauffeurPositions);
    newPositions.delete(chauffeurId);
    set({ chauffeurPositions: newPositions });
  },

  clearAllPositions: () => {
    set({ chauffeurPositions: new Map() });
  },

  setAllPositions: (positions) => {
    const newPositions = new Map<string, ChauffeurPosition>();

    // Handle both array and object formats
    if (Array.isArray(positions)) {
      positions.forEach((pos) => {
        newPositions.set(pos.chauffeurId, pos);
      });
    } else if (positions && typeof positions === 'object') {
      // Handle Record<chauffeurId, position> format from backend
      Object.entries(positions).forEach(([chauffeurId, pos]) => {
        newPositions.set(chauffeurId, { ...(pos as any), chauffeurId });
      });
    }

    set({ chauffeurPositions: newPositions });
  },
}));

/**
 * Helper to check if a position is stale (older than 5 minutes)
 */
export function isPositionStale(position: ChauffeurPosition): boolean {
  const now = Date.now();
  return now - position.timestamp > POSITION_STALE_TIMEOUT;
}

/**
 * Get positions as an array with stale status
 */
export function getPositionsWithStatus(positions: Map<string, ChauffeurPosition>): Array<ChauffeurPosition & { isStale: boolean }> {
  return Array.from(positions.values()).map((pos) => ({
    ...pos,
    isStale: isPositionStale(pos),
  }));
}
