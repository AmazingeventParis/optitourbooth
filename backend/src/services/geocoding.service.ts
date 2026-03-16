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

    // Stratégie multi-tentatives pour gérer les lieux d'intérêt (POI),
    // adresses sans numéro, noms de lieux connus, etc.
    const strategies = this._buildSearchStrategies(adresse, codePostal, ville, pays);

    for (const strategy of strategies) {
      const result = await this._nominatimSearch(strategy.params);
      if (result) {
        console.log(`[Geocoding] Trouvé via stratégie "${strategy.name}": ${fullAddress} -> ${result.displayName}`);
        geocodeCache.set(cacheKey, result);
        return result;
      }
    }

    console.warn(`[Geocoding] Aucun résultat après ${strategies.length} tentatives pour: ${fullAddress}`);
    return null;
  },

  /**
   * Build multiple search strategies for Nominatim (fallback chain)
   */
  _buildSearchStrategies(
    adresse: string,
    codePostal?: string,
    ville?: string,
    pays = 'France'
  ): Array<{ name: string; params: URLSearchParams }> {
    const strategies: Array<{ name: string; params: URLSearchParams }> = [];

    // Extract postal code from address if present (e.g. "lieu 75016")
    const postalMatch = adresse.match(/\b(\d{5})\b/);
    const extractedPostal = postalMatch?.[1];
    const effectivePostal = codePostal || extractedPostal;
    // Address without the postal code for cleaner searches
    const adresseSansCP = postalMatch ? adresse.replace(postalMatch[0], '').replace(/,\s*$/, '').trim() : adresse;

    // 1. Full address query (original behavior)
    const fullParts = [adresse];
    if (codePostal) fullParts.push(codePostal);
    if (ville) fullParts.push(ville);
    fullParts.push(pays);
    strategies.push({
      name: 'full_address',
      params: new URLSearchParams({ q: fullParts.join(', '), format: 'json', limit: '1', addressdetails: '1', countrycodes: 'fr' }),
    });

    // 2. Structured search with postal code (better for POI + postal code)
    if (effectivePostal) {
      const structuredParams = new URLSearchParams({
        q: adresseSansCP,
        format: 'json',
        limit: '1',
        addressdetails: '1',
        countrycodes: 'fr',
        postalcode: effectivePostal,
      });
      strategies.push({ name: 'structured_postal', params: structuredParams });
    }

    // 3. Try with just the address + country (drop postal/ville noise)
    strategies.push({
      name: 'address_only',
      params: new URLSearchParams({ q: `${adresse}, ${pays}`, format: 'json', limit: '1', addressdetails: '1', countrycodes: 'fr' }),
    });

    // 4. Multi-part address: try each part separately
    const commaParts = adresse.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length > 1) {
      // 4a. Try the street/location part (after comma) + postal + country
      const streetPart = commaParts.slice(1).join(', ');
      const streetQuery = effectivePostal ? `${streetPart}, ${effectivePostal}, ${pays}` : `${streetPart}, ${pays}`;
      strategies.push({
        name: 'street_part',
        params: new URLSearchParams({ q: streetQuery, format: 'json', limit: '1', addressdetails: '1', countrycodes: 'fr' }),
      });

      // 4b. Try POI name + postal code
      const poiName = commaParts[0];
      const poiQuery = effectivePostal ? `${poiName}, ${effectivePostal}, ${pays}` : `${poiName}, ${pays}`;
      strategies.push({
        name: 'poi_name',
        params: new URLSearchParams({ q: poiQuery, format: 'json', limit: '1', addressdetails: '1', countrycodes: 'fr' }),
      });
    }

    // 5. Simplified: just the main name + city/postal (strip street details)
    // Extract what looks like a place name (before numbers or common street words)
    const placeName = adresse.replace(/\b\d+\b/g, '').replace(/\b(rue|avenue|boulevard|allée|impasse|chemin|route|place|carrefour|passage|cours|quai)\b/gi, '').replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (placeName && placeName !== adresse) {
      const simplifiedQuery = effectivePostal ? `${placeName}, ${effectivePostal}, ${pays}` : `${placeName}, ${pays}`;
      strategies.push({
        name: 'place_name_only',
        params: new URLSearchParams({ q: simplifiedQuery, format: 'json', limit: '1', addressdetails: '1', countrycodes: 'fr' }),
      });
    }

    return strategies;
  },

  /**
   * Execute a single Nominatim search
   */
  async _nominatimSearch(params: URLSearchParams): Promise<GeocodingResult | null> {
    try {
      const url = `${config.nominatim.url}/search?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'OptiTourBooth/1.0 (contact@shootnbox.fr)',
          'Accept-Language': 'fr',
        },
      });

      if (!response.ok) {
        console.error(`Erreur Nominatim: ${response.status}`);
        await sleep(1000);
        return null;
      }

      const data = (await response.json()) as NominatimResponse[];
      await sleep(1000); // Rate limit

      if (!data || data.length === 0) return null;

      return {
        latitude: parseFloat(data[0]!.lat),
        longitude: parseFloat(data[0]!.lon),
        displayName: data[0]!.display_name,
      };
    } catch (error) {
      console.error('Erreur Nominatim:', error);
      await sleep(1000);
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
