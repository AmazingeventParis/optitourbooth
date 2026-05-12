import { prisma } from '../config/database.js';
import { fetchAllParcels } from './chronotraceApi.service.js';
import { trackParcel, inferStatutFromSignificantEvent } from './chronopost.service.js';
import { ChronopostStatut } from '@prisma/client';

export async function syncChronopostAuto(): Promise<void> {
  let sessionConfigured = false;
  try {
    const session = await prisma.chronotraceSession.findUnique({ where: { id: 'singleton' } });
    sessionConfigured = !!session;
  } catch {
    sessionConfigured = false;
  }

  if (sessionConfigured) {
    await syncViaChronotrace();
  } else {
    await syncViaTrackingApi();
  }

  // Always run reconciliation after any sync: links return parcels to their
  // outbound based on matching clientNom, independently of Chronotrace session.
  await reconcileReturnParcels();
}

// Scans all expeditions in DB and links standalone return parcels (en_retour/rentre)
// to their matching outbound (expedie/livre) by normalized clientNom.
export async function reconcileReturnParcels(): Promise<void> {
  // Return parcels: en_retour or rentre, with no outbound linking them
  // (i.e. they are themselves return parcels, not outbound parcels that were returned)
  const allExpeditions = await prisma.chronopostExpedition.findMany();

  const outbounds = allExpeditions.filter(e =>
    (e.statut === 'expedie' || e.statut === 'livre') && !e.numeroColisRetour
  );
  const standaloneReturns = allExpeditions.filter(e =>
    e.statut === 'en_retour' || (e.statut === 'rentre' && !outbounds.some(o => o.numeroColisRetour === e.numeroColis))
  );

  let linked = 0;

  for (const ret of standaloneReturns) {
    const normalizedRet = normalizeClientNom(ret.clientNom);
    if (!normalizedRet) continue;

    const match = outbounds.find(o =>
      normalizeClientNom(o.clientNom) === normalizedRet &&
      o.numeroColis !== ret.numeroColis
    );

    if (!match) {
      const isAmazingEvent = /amazing\s*event/i.test(ret.clientNom);
      if (isAmazingEvent) {
        console.warn(`[Reconcile] Return ${ret.numeroColis} has clientNom="${ret.clientNom}" (AMAZING EVENT = wrong name from SOAP). Fix manually via UI: open the outbound → set "N° colis retour" = ${ret.numeroColis}`);
      } else {
        console.log(`[Reconcile] No outbound match for return ${ret.numeroColis} (${ret.clientNom} → "${normalizedRet}")`);
        for (const o of outbounds) {
          console.log(`  candidate: ${o.numeroColis} "${o.clientNom}" → "${normalizeClientNom(o.clientNom)}"`);
        }
      }
      continue;
    }

    console.log(`[Reconcile] Linking return ${ret.numeroColis} → outbound ${match.numeroColis} (${match.clientNom})`);

    await prisma.chronopostExpedition.update({
      where: { id: match.id },
      data: {
        numeroColisRetour: ret.numeroColis,
        ...(!match.dateRetourPrevu && ret.dateDepart ? { dateRetourPrevu: ret.dateDepart } : {}),
        ...(ret.statut === 'rentre' && ret.dateLivraisonReelle ? { dateRetourReel: ret.dateLivraisonReelle, statut: 'rentre' as ChronopostStatut } : {}),
      },
    });

    await prisma.chronopostExpedition.delete({ where: { id: ret.id } });

    // Remove from outbounds so it's not matched again
    outbounds.splice(outbounds.indexOf(match), 1);
    linked++;
  }

  if (linked > 0) {
    console.log(`[Reconcile] Done — ${linked} return(s) linked to outbound`);
  }
}

// Normalize a client name for fuzzy matching: remove accents, lowercase, sort words.
// "LAINÉ Inès" and "ines lainé" both normalize to "ines laine".
function normalizeClientNom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .sort()
    .join(' ');
}

async function findMatchingOutbound(clientNom: string, returnNumeroColis: string) {
  const normalized = normalizeClientNom(clientNom);
  if (!normalized) return null;

  // Fetch active outbound expeditions (not yet returned, not already linked to a return)
  const candidates = await prisma.chronopostExpedition.findMany({
    where: {
      statut: { in: ['expedie', 'livre'] },
      numeroColisRetour: null,
      // Exclude the return parcel itself if it was previously stored as outbound
      numeroColis: { not: returnNumeroColis },
    },
  });

  for (const c of candidates) {
    if (normalizeClientNom(c.clientNom) === normalized) return c;
  }
  return null;
}

async function syncViaChronotrace(): Promise<void> {
  console.log('[Chronopost CRON] Syncing via Chronotrace REST API...');
  let created = 0;
  let updated = 0;
  let linked = 0;
  let errors = 0;

  try {
    const parcels = await fetchAllParcels();

    // Pass 1: upsert outbound parcels so they exist before return linking
    for (const p of parcels.filter(p => !p.isRetour)) {
      try {
        const existing = await prisma.chronopostExpedition.findUnique({ where: { numeroColis: p.numeroColis } });
        if (!existing) {
          await prisma.chronopostExpedition.create({
            data: {
              numeroColis: p.numeroColis,
              clientNom: p.clientNom,
              clientVille: p.clientVille || null,
              clientAdresse: p.clientAdresse || null,
              dateDepart: p.dateDepart,
              dateLivraisonReelle: p.dateLivraisonReelle,
              statut: p.statut,
            },
          });
          created++;
        } else {
          const newStatut = existing.statut === 'rentre' ? 'rentre' : p.statut;
          await prisma.chronopostExpedition.update({
            where: { id: existing.id },
            data: {
              statut: newStatut,
              clientNom: p.clientNom || existing.clientNom,
              clientVille: p.clientVille || existing.clientVille,
              ...(p.dateDepart && !existing.dateDepart && { dateDepart: p.dateDepart }),
              ...(p.dateLivraisonReelle && !existing.dateLivraisonReelle && { dateLivraisonReelle: p.dateLivraisonReelle }),
            },
          });
          updated++;
        }
      } catch (err) {
        console.error(`[Chronopost CRON] Error on ${p.numeroColis}:`, err);
        errors++;
      }
    }

    // Pass 2: process return parcels — link to their outbound instead of creating standalone records
    for (const p of parcels.filter(p => p.isRetour)) {
      try {
        const outbound = await findMatchingOutbound(p.clientNom, p.numeroColis);

        if (outbound) {
          // Link return data to the outbound expedition
          const isDeliveredBack = p.statut === 'rentre';
          await prisma.chronopostExpedition.update({
            where: { id: outbound.id },
            data: {
              numeroColisRetour: p.numeroColis,
              // dateRetourPrevu = pickup date from client (return parcel departure)
              ...(p.dateDepart && !outbound.dateRetourPrevu && { dateRetourPrevu: p.dateDepart }),
              // dateRetourReel = when it's actually delivered back to us
              ...(isDeliveredBack && p.dateLivraisonReelle && { dateRetourReel: p.dateLivraisonReelle, statut: 'rentre' }),
            },
          });
          // Remove any standalone return record that may have been created in a previous sync
          const standaloneReturn = await prisma.chronopostExpedition.findUnique({ where: { numeroColis: p.numeroColis } });
          if (standaloneReturn) {
            await prisma.chronopostExpedition.delete({ where: { id: standaloneReturn.id } });
          }
          linked++;
          console.log(`[Chronopost CRON] Linked return ${p.numeroColis} → outbound ${outbound.numeroColis} (${outbound.clientNom})`);
        } else {
          // No matching outbound found — keep as standalone for visibility
          const existing = await prisma.chronopostExpedition.findUnique({ where: { numeroColis: p.numeroColis } });
          if (!existing) {
            await prisma.chronopostExpedition.create({
              data: {
                numeroColis: p.numeroColis,
                clientNom: p.clientNom,
                clientVille: p.clientVille || null,
                clientAdresse: p.clientAdresse || null,
                dateDepart: p.dateDepart,
                dateLivraisonReelle: p.dateLivraisonReelle,
                statut: p.statut,
              },
            });
            created++;
          } else {
            const newStatut = existing.statut === 'rentre' ? 'rentre' : p.statut;
            await prisma.chronopostExpedition.update({
              where: { id: existing.id },
              data: {
                statut: newStatut,
                ...(p.dateDepart && !existing.dateDepart && { dateDepart: p.dateDepart }),
                ...(p.dateLivraisonReelle && !existing.dateLivraisonReelle && { dateLivraisonReelle: p.dateLivraisonReelle }),
              },
            });
            updated++;
          }
        }
      } catch (err) {
        console.error(`[Chronopost CRON] Error on return ${p.numeroColis}:`, err);
        errors++;
      }
    }

    console.log(`[Chronopost CRON] Done — ${created} new, ${updated} updated, ${linked} return linked${errors ? `, ${errors} errors` : ''}`);
  } catch (err: any) {
    if (err.message?.includes('session') || err.message?.includes('401') || err.message?.includes('403')) {
      console.warn('[Chronopost CRON] Session expired — cookies need refresh. Falling back to SOAP.');
    } else {
      console.error('[Chronopost CRON] Chronotrace error:', err.message);
    }
    await syncViaTrackingApi();
  }
}

async function syncViaTrackingApi(): Promise<void> {
  const parcels = await prisma.chronopostExpedition.findMany({
    where: { statut: { notIn: ['rentre'] } },
  });

  if (parcels.length === 0) {
    console.log('[Chronopost CRON] No active parcels to refresh via SOAP');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const parcel of parcels) {
    try {
      const result = await trackParcel(parcel.numeroColis);
      if (result.errorCode !== '0' && result.errorCode !== '000') continue;

      const lastEvent = result.events[result.events.length - 1];
      const statut = inferStatutFromSignificantEvent(
        lastEvent ? { code: lastEvent.code, eventDate: lastEvent.date, eventLabel: lastEvent.libelle } : undefined,
      ) as ChronopostStatut;

      const sortedDates = result.events.map((e) => e.date).filter(Boolean).sort();
      const dateDepart = sortedDates[0] ? new Date(sortedDates[0]) : parcel.dateDepart;

      await prisma.chronopostExpedition.update({
        where: { id: parcel.id },
        data: {
          trackingData: result as any,
          statut,
          clientNom: result.recipientName || parcel.clientNom,
          clientVille: result.recipientCity || parcel.clientVille,
          dateDepart: dateDepart || parcel.dateDepart,
        },
      });
      updated++;
    } catch {
      errors++;
    }
  }

  console.log(`[Chronopost CRON] SOAP: ${updated}/${parcels.length} updated${errors ? ` (${errors} errors)` : ''}`);
}
