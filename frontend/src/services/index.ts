export { default as api } from './api';
export type { ApiResponse, ApiError } from './api';

export { authService } from './auth.service';
export { usersService } from './users.service';
export { clientsService } from './clients.service';
export { produitsService } from './produits.service';
export { tourneesService } from './tournees.service';
export { gpsService } from './gps.service';
export { socketService } from './socket.service';
export type { ChauffeurPosition, PositionUpdate, PointStatusUpdate, IncidentAlert, TourneeUpdate } from './socket.service';
