import * as XLSX from 'xlsx';
import { prisma } from '../config/database.js';
import { PointType } from '@prisma/client';
import { geocodingService } from './geocoding.service.js';

interface ImportedRow {
  CLIENT: string;
  SOCIETE?: string;
  ADRESSE?: string;
  PRODUIT?: string;
  TYPE: string;
  'DEBUT CRENEAU'?: string;
  'FIN CRENEAU'?: string;
  CONTACT?: string;
  TELEPHONE?: string;
  INFOS?: string;
}

interface ParsedPoint {
  clientName: string;
  societe?: string;
  adresse?: string;
  produitName?: string;
  produitCouleur?: string;
  type: PointType;
  creneauDebut?: string;
  creneauFin?: string;
  contactNom?: string;
  contactTelephone?: string;
  notes?: string;
  // Résolution
  clientId?: string;
  produitId?: string;
  clientFound: boolean;
  produitFound: boolean;
  errors: string[];
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  imported: number;
  errors: Array<{ row: number; message: string }>;
  points: ParsedPoint[];
}

function normalizeType(type: string): PointType {
  const normalized = type.toLowerCase().trim();
  if (normalized.includes('ramassage') && normalized.includes('livraison')) {
    return 'livraison_ramassage';
  }
  if (normalized.includes('ramassage') || normalized.includes('récup') || normalized.includes('recup')) {
    return 'ramassage';
  }
  return 'livraison';
}

function normalizeTime(time: string | number | undefined): string | undefined {
  if (!time) return undefined;

  // Si c'est un nombre (fraction de jour Excel)
  if (typeof time === 'number') {
    const totalMinutes = Math.round(time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const timeStr = String(time).trim();

  // Format HH:MM
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
    const [hours, minutes] = timeStr.split(':');
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  // Format HHMM
  if (/^\d{4}$/.test(timeStr)) {
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
  }

  // Format HMM (ex: 900 pour 9:00)
  if (/^\d{3}$/.test(timeStr)) {
    return `0${timeStr.slice(0, 1)}:${timeStr.slice(1)}`;
  }

  return timeStr;
}

function normalizePhone(phone: string | number | undefined): string | undefined {
  if (!phone) return undefined;

  let phoneStr = String(phone).trim();

  // Supprimer les espaces et caractères non numériques sauf le +
  phoneStr = phoneStr.replace(/[^\d+]/g, '');

  // Si le numéro commence par un chiffre et fait 9 chiffres, ajouter le 0
  if (/^\d{9}$/.test(phoneStr)) {
    phoneStr = '0' + phoneStr;
  }

  return phoneStr || undefined;
}

export const importService = {
  /**
   * Parse un fichier Excel et retourne les données pour prévisualisation
   */
  async parseExcel(buffer: Buffer): Promise<ParsedPoint[]> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Le fichier Excel ne contient aucune feuille');
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error('Impossible de lire la feuille Excel');
    }

    // Convertir en JSON avec les headers
    const rows = XLSX.utils.sheet_to_json<ImportedRow>(sheet, { defval: '' });

    const parsedPoints: ParsedPoint[] = [];

    for (const row of rows) {
      // Ignorer les lignes vides
      if (!row.CLIENT || String(row.CLIENT).trim() === '') {
        continue;
      }

      const clientName = String(row.CLIENT).trim();
      const produitName = row.PRODUIT ? String(row.PRODUIT).trim() : undefined;

      const parsed: ParsedPoint = {
        clientName,
        societe: row.SOCIETE ? String(row.SOCIETE).trim() : undefined,
        adresse: row.ADRESSE ? String(row.ADRESSE).trim() : undefined,
        produitName,
        type: normalizeType(row.TYPE || 'livraison'),
        creneauDebut: normalizeTime(row['DEBUT CRENEAU']),
        creneauFin: normalizeTime(row['FIN CRENEAU']),
        contactNom: row.CONTACT ? String(row.CONTACT).trim() : undefined,
        contactTelephone: normalizePhone(row.TELEPHONE),
        notes: row.INFOS ? String(row.INFOS).trim() : undefined,
        clientFound: false,
        produitFound: false,
        errors: [],
      };

      // Rechercher le client par nom OU par société (recherche flexible)
      let client = await prisma.client.findFirst({
        where: {
          OR: [
            { nom: { contains: clientName, mode: 'insensitive' } },
            { nom: { equals: clientName, mode: 'insensitive' } },
            { societe: { contains: clientName, mode: 'insensitive' } },
            { societe: { equals: clientName, mode: 'insensitive' } },
          ],
          actif: true,
        },
      });

      if (client) {
        parsed.clientId = client.id;
        parsed.clientFound = true;
      } else {
        // Client non trouvé - le créer automatiquement si on a une adresse
        if (parsed.adresse) {
          try {
            // Géocoder l'adresse pour obtenir les coordonnées
            let latitude: number | undefined;
            let longitude: number | undefined;

            const geocodeResult = await geocodingService.geocodeAddress(parsed.adresse);
            if (geocodeResult) {
              latitude = geocodeResult.latitude;
              longitude = geocodeResult.longitude;
              console.log(`[IMPORT] Géocodage réussi pour "${clientName}": ${latitude}, ${longitude}`);
            } else {
              console.warn(`[IMPORT] Échec géocodage pour "${clientName}" - adresse: ${parsed.adresse}`);
            }

            // Créer le nouveau client
            client = await prisma.client.create({
              data: {
                nom: clientName,
                societe: parsed.societe,
                adresse: parsed.adresse,
                latitude,
                longitude,
                contactNom: parsed.contactNom,
                contactTelephone: parsed.contactTelephone,
                actif: true,
              },
            });

            parsed.clientId = client.id;
            parsed.clientFound = true;
            console.log(`[IMPORT] Nouveau client créé: "${clientName}" (ID: ${client.id})`);
          } catch (error) {
            console.error(`[IMPORT] Erreur création client "${clientName}":`, error);
            parsed.errors.push(`Impossible de créer le client "${clientName}": ${(error as Error).message}`);
          }
        } else {
          parsed.errors.push(`Client "${clientName}" non trouvé et pas d'adresse fournie pour le créer`);
        }
      }

      // Rechercher le produit par nom (si spécifié)
      if (produitName) {
        const produit = await prisma.produit.findFirst({
          where: {
            nom: { contains: produitName, mode: 'insensitive' },
            actif: true,
          },
        });

        if (produit) {
          parsed.produitId = produit.id;
          parsed.produitCouleur = produit.couleur || undefined;
          parsed.produitFound = true;
        } else {
          parsed.errors.push(`Produit "${produitName}" non trouvé`);
        }
      } else {
        parsed.produitFound = true; // Pas de produit requis
      }

      parsedPoints.push(parsed);
    }

    return parsedPoints;
  },

  /**
   * Convertit une heure HH:MM en DateTime complet basé sur une date de référence
   */
  timeToDateTime(timeStr: string | undefined, referenceDate: Date): Date | undefined {
    if (!timeStr) return undefined;

    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match || !match[1] || !match[2]) return undefined;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    const result = new Date(referenceDate);
    result.setHours(hours, minutes, 0, 0);
    return result;
  },

  /**
   * Importe les points dans une tournée
   */
  async importPoints(tourneeId: string, parsedPoints: ParsedPoint[]): Promise<ImportResult> {
    const result: ImportResult = {
      success: true,
      totalRows: parsedPoints.length,
      imported: 0,
      errors: [],
      points: parsedPoints,
    };

    // Vérifier que la tournée existe
    const tournee = await prisma.tournee.findUnique({
      where: { id: tourneeId },
      include: { points: true },
    });

    if (!tournee) {
      result.success = false;
      result.errors.push({ row: 0, message: 'Tournée non trouvée' });
      return result;
    }

    // Calculer l'ordre de départ (après les points existants)
    let currentOrdre = tournee.points.length;

    for (const [index, parsed] of parsedPoints.entries()) {
      // Vérifier que le client existe
      if (!parsed.clientId) {
        result.errors.push({ row: index + 2, message: `Client "${parsed.clientName}" non trouvé` });
        continue;
      }

      // Convertir les heures en DateTime complet
      const creneauDebutDate = this.timeToDateTime(parsed.creneauDebut, tournee.date);
      const creneauFinDate = this.timeToDateTime(parsed.creneauFin, tournee.date);

      try {
        // Créer le point
        const point = await prisma.point.create({
          data: {
            tourneeId,
            clientId: parsed.clientId,
            type: parsed.type,
            ordre: currentOrdre,
            statut: 'a_faire',
            creneauDebut: creneauDebutDate,
            creneauFin: creneauFinDate,
            notesInternes: parsed.notes,
            dureePrevue: 30, // Durée par défaut
          },
        });

        // Ajouter le produit si spécifié
        if (parsed.produitId) {
          await prisma.pointProduit.create({
            data: {
              pointId: point.id,
              produitId: parsed.produitId,
              quantite: 1,
            },
          });
        }

        // Mettre à jour le contact du client si fourni
        if (parsed.contactNom || parsed.contactTelephone) {
          await prisma.client.update({
            where: { id: parsed.clientId },
            data: {
              ...(parsed.contactNom && { contactNom: parsed.contactNom }),
              ...(parsed.contactTelephone && { contactTelephone: parsed.contactTelephone }),
            },
          });
        }

        currentOrdre++;
        result.imported++;
      } catch (error) {
        result.errors.push({
          row: index + 2,
          message: `Erreur lors de la création: ${(error as Error).message}`
        });
      }
    }

    // Mettre à jour le nombre de points de la tournée
    await prisma.tournee.update({
      where: { id: tourneeId },
      data: { nombrePoints: currentOrdre },
    });

    result.success = result.errors.length === 0;

    return result;
  },
};
