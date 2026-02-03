import { config } from '../config/index.js';
import { sleep } from '../utils/index.js';

interface GeocodingResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

interface NominatimResponse {
  lat: string;
  lon: string;
  display_name: string;
}

// Cache simple en mémoire pour éviter les requêtes répétées
const geocodeCache = new Map<string, GeocodingResult>();

export const geocodingService = {
  /**
   * Géocoder une adresse (convertir adresse -> coordonnées GPS)
   * Utilise Nominatim (OpenStreetMap) - gratuit, 1 requête/seconde max
   */
  async geocodeAddress(
    adresse: string,
    codePostal?: string,
    ville?: string,
    pays = 'France'
  ): Promise<GeocodingResult | null> {
    // Construire l'adresse complète en fonction des champs disponibles
    const addressParts = [adresse];
    if (codePostal) addressParts.push(codePostal);
    if (ville) addressParts.push(ville);
    addressParts.push(pays);
    const fullAddress = addressParts.join(', ');
    const cacheKey = fullAddress.toLowerCase();

    // Vérifier le cache
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey)!;
    }

    try {
      // Construire l'URL Nominatim
      const params = new URLSearchParams({
        q: fullAddress,
        format: 'json',
        limit: '1',
        addressdetails: '1',
      });

      const url = `${config.nominatim.url}/search?${params.toString()}`;

      // Faire la requête avec un User-Agent (requis par Nominatim)
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'OptiTourBooth/1.0 (contact@shootnbox.fr)',
          'Accept-Language': 'fr',
        },
      });

      if (!response.ok) {
        console.error(`Erreur Nominatim: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as NominatimResponse[];

      if (!data || data.length === 0) {
        console.warn(`Aucun résultat de géocodage pour: ${fullAddress}`);
        return null;
      }

      const result: GeocodingResult = {
        latitude: parseFloat(data[0]!.lat),
        longitude: parseFloat(data[0]!.lon),
        displayName: data[0]!.display_name,
      };

      // Mettre en cache
      geocodeCache.set(cacheKey, result);

      // Respecter la limite de 1 req/sec de Nominatim
      await sleep(1000);

      return result;
    } catch (error) {
      console.error('Erreur de géocodage:', error);
      return null;
    }
  },

  /**
   * Géocodage inverse (coordonnées -> adresse)
   */
  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        lat: latitude.toString(),
        lon: longitude.toString(),
        format: 'json',
      });

      const url = `${config.nominatim.url}/reverse?${params.toString()}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'OptiTourBooth/1.0 (contact@shootnbox.fr)',
          'Accept-Language': 'fr',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as NominatimResponse;

      // Respecter la limite de 1 req/sec
      await sleep(1000);

      return data.display_name || null;
    } catch (error) {
      console.error('Erreur de géocodage inverse:', error);
      return null;
    }
  },

  /**
   * Géocoder plusieurs adresses en batch (avec respect du rate limit)
   */
  async geocodeBatch(
    addresses: Array<{
      id: string;
      adresse: string;
      codePostal?: string | null;
      ville?: string | null;
      pays?: string;
    }>
  ): Promise<Map<string, GeocodingResult | null>> {
    const results = new Map<string, GeocodingResult | null>();

    for (const addr of addresses) {
      const result = await this.geocodeAddress(
        addr.adresse,
        addr.codePostal || undefined,
        addr.ville || undefined,
        addr.pays
      );
      results.set(addr.id, result);
    }

    return results;
  },

  /**
   * Vider le cache de géocodage
   */
  clearCache(): void {
    geocodeCache.clear();
  },

  /**
   * Obtenir la taille du cache
   */
  getCacheSize(): number {
    return geocodeCache.size;
  },
};
