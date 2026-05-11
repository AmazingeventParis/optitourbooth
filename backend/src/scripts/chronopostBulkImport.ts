import { prisma } from '../config/database.js';
import { trackParcel, inferStatutFromSignificantEvent } from '../services/chronopost.service.js';
import { ChronopostStatut } from '@prisma/client';

interface ParcelSeed {
  numeroColis: string;
  clientNom: string;
  clientVille: string;
  clientAdresse: string;
  statut: ChronopostStatut;
}

const PARCELS: ParcelSeed[] = [
  // --- En cours d'acheminement (outbound) ---
  { numeroColis: 'XN263967731FR', clientNom: 'Pareti Pierrick',            clientVille: 'STE CONSORCE',        clientAdresse: '69280', statut: 'expedie' },
  { numeroColis: 'XN262608278FR', clientNom: 'Olanda Gaetan',              clientVille: 'SENNECEY LES DIJON',  clientAdresse: '21800', statut: 'expedie' },
  { numeroColis: 'XN262589485FR', clientNom: 'Paulin Sebastien',           clientVille: 'CHAZAY D AZERGUES',   clientAdresse: '69380', statut: 'expedie' },
  { numeroColis: 'XN267878731FR', clientNom: 'Guerrin Michael',            clientVille: 'JOUE LES TOURS',      clientAdresse: '37300', statut: 'expedie' },
  { numeroColis: 'XN265462890FR', clientNom: 'Benzaouche Kamelia',         clientVille: 'DAME MARIE',          clientAdresse: '61130', statut: 'expedie' },
  // --- Retours en cours (→ Amazing Event) ---
  { numeroColis: 'XN257024486FR', clientNom: 'Heini Luc',                  clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'en_retour' },
  { numeroColis: 'XN256427427FR', clientNom: 'Adeline Bonnot',             clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'en_retour' },
  { numeroColis: 'XN255109731FR', clientNom: 'Ines Lainé',                 clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'en_retour' },
  // --- Livrés au client ---
  { numeroColis: 'XN257024490FR', clientNom: 'Heini Luc',                  clientVille: 'CARCANS',             clientAdresse: '33121', statut: 'livre' },
  { numeroColis: 'XN256427444FR', clientNom: 'Adeline Bonnot',             clientVille: 'ST MEDARD EN JALLES', clientAdresse: '33160', statut: 'livre' },
  { numeroColis: 'XN255109745FR', clientNom: 'Ines Lainé',                 clientVille: 'CHATENOIS',           clientAdresse: '88170', statut: 'livre' },
  { numeroColis: 'XN250924865FR', clientNom: 'Boudard Sylvie',             clientVille: 'HARGEVILLE',          clientAdresse: '78790', statut: 'livre' },
  { numeroColis: 'XN250936815FR', clientNom: 'Hermman Remi',               clientVille: 'BOULIAC',             clientAdresse: '33270', statut: 'livre' },
  { numeroColis: 'XN250941333FR', clientNom: 'Marie-Noëlle Lamourette',    clientVille: 'MAUGUIO',             clientAdresse: '34130', statut: 'livre' },
  { numeroColis: 'XN250910764FR', clientNom: 'Stephanie Deshayes',         clientVille: 'ANDERNOS LES BAINS',  clientAdresse: '33510', statut: 'livre' },
  { numeroColis: 'XN243240202FR', clientNom: 'Lejeune Virginie',           clientVille: 'LENCOUACQ',           clientAdresse: '40120', statut: 'livre' },
  { numeroColis: 'XN243092747FR', clientNom: 'Marin Florence',             clientVille: 'TERGNIER',            clientAdresse: '02700', statut: 'livre' },
  { numeroColis: 'XN237844898FR', clientNom: 'Bustin Julie',               clientVille: 'CROIX FONSOMMES',     clientAdresse: '02110', statut: 'livre' },
  { numeroColis: 'XN231295464FR', clientNom: 'Sandro Dos Santos Morais',   clientVille: 'AUNEAU',              clientAdresse: '28700', statut: 'livre' },
  { numeroColis: 'XN222604511FR', clientNom: 'Petitprez Charlotte',        clientVille: 'TOUFFLERS',           clientAdresse: '59390', statut: 'livre' },
  { numeroColis: 'XN224034154FR', clientNom: 'Gally Richard',              clientVille: 'GENISSAC',            clientAdresse: '33420', statut: 'livre' },
  { numeroColis: 'XN222613650FR', clientNom: 'Astrid Dupond',              clientVille: 'ROMEGOUX',            clientAdresse: '17250', statut: 'livre' },
  // --- Rentrés (retours livrés à Amazing Event) ---
  { numeroColis: 'XN250941320FR', clientNom: 'Marie-Noëlle Lamourette',    clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN250924848FR', clientNom: 'Boudard Sylvie',             clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN250910747FR', clientNom: 'Stephanie Deshayes',         clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN250936801FR', clientNom: 'Hermman Remi',               clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN243092733FR', clientNom: 'Marin Florence',             clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN243240162FR', clientNom: 'Lejeune Virginie',           clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN237844875FR', clientNom: 'Bustin Julie',               clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN231295447FR', clientNom: 'Sandro Dos Santos Morais',   clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN222604508FR', clientNom: 'Petitprez Charlotte',        clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN222613632FR', clientNom: 'Astrid Dupond',              clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
  { numeroColis: 'XN224034145FR', clientNom: 'Gally Richard',              clientVille: 'MONTREUIL',           clientAdresse: '93100', statut: 'rentre' },
];

export async function runChronopostBulkImport(): Promise<void> {
  let created = 0;
  let skipped = 0;

  for (const seed of PARCELS) {
    try {
      const existing = await prisma.chronopostExpedition.findUnique({
        where: { numeroColis: seed.numeroColis },
      });
      if (existing) { skipped++; continue; }

      // Try to get real tracking data from Chronopost
      let trackingData: any = null;
      let dateDepart: Date | null = null;
      let statut = seed.statut;

      try {
        const result = await trackParcel(seed.numeroColis);
        if (result.events.length > 0) {
          trackingData = result;
          const sortedDates = result.events.map(e => e.date).filter(Boolean).sort();
          dateDepart = sortedDates[0] ? new Date(sortedDates[0]) : null;
          // Only infer statut from tracking if not manually set to 'rentre'
          if (seed.statut !== 'rentre') {
            const lastEvent = result.events[result.events.length - 1];
            const inferred = inferStatutFromSignificantEvent(
              lastEvent ? { code: lastEvent.code, eventDate: lastEvent.date, eventLabel: lastEvent.libelle } : undefined,
            ) as ChronopostStatut;
            // Use inferred only if it's more "advanced" than seed statut
            if (inferred === 'livre' || inferred === 'en_retour') statut = inferred;
          }
        }
      } catch {
        // Tracking call failed — use seed data as fallback
      }

      await prisma.chronopostExpedition.create({
        data: {
          numeroColis: seed.numeroColis,
          clientNom: seed.clientNom,
          clientVille: seed.clientVille,
          clientAdresse: seed.clientAdresse,
          dateDepart,
          statut,
          trackingData: trackingData as any,
        },
      });
      created++;
    } catch (err) {
      console.error(`[Chronopost Import] Error on ${seed.numeroColis}:`, err);
    }
  }

  console.log(`[Chronopost Import] Done — ${created} created, ${skipped} already existed`);
}
