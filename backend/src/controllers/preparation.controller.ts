import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { PreparationStatut } from '@prisma/client';

/**
 * Auto-transition des statuts de préparation selon la date
 */
export async function autoUpdatePreparationStatuses(): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log(`[Auto-Prep] Vérification à ${new Date().toISOString()}`);
    console.log(`[Auto-Prep] Aujourd'hui (cutoff): ${today.toISOString()}`);

    // 1. Passer "prete" → "en_cours" le jour de l'événement
    const readyPreps = await prisma.preparation.findMany({
      where: {
        statut: 'prete',
        dateEvenement: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    if (readyPreps.length > 0) {
      await prisma.preparation.updateMany({
        where: {
          id: { in: readyPreps.map(p => p.id) },
        },
        data: { statut: 'en_cours' },
      });
      console.log(`[Auto-Prep] ${readyPreps.length} préparation(s) passée(s) en "en_cours"`);
    }

    // 2a. Passer "prete" avec date passée → "a_decharger" (si jamais passée en "en_cours")
    const missedReadyPreps = await prisma.preparation.findMany({
      where: {
        statut: 'prete',
        dateEvenement: {
          lt: today,
        },
      },
    });

    console.log(`[Auto-Prep] Trouvé ${missedReadyPreps.length} préparation(s) "prete" avec date passée`);
    if (missedReadyPreps.length > 0) {
      missedReadyPreps.forEach(p => {
        console.log(`[Auto-Prep]   - ID ${p.id.substring(0, 8)} dateEvenement: ${p.dateEvenement.toISOString()}`);
      });
      await prisma.preparation.updateMany({
        where: {
          id: { in: missedReadyPreps.map(p => p.id) },
        },
        data: { statut: 'a_decharger' },
      });
      console.log(`[Auto-Prep] ${missedReadyPreps.length} préparation(s) "prete" passée(s) directement en "a_decharger"`);
    }

    // 2b. Passer "en_cours" → "a_decharger" le lendemain du dernier événement
    // Pour chaque machine, trouver la dernière date d'événement
    const ongoingPreps = await prisma.preparation.findMany({
      where: { statut: 'en_cours' },
      include: { machine: true },
    });

    const prepsByMachine = new Map<string, typeof ongoingPreps>();
    ongoingPreps.forEach(prep => {
      const existing = prepsByMachine.get(prep.machineId) || [];
      existing.push(prep);
      prepsByMachine.set(prep.machineId, existing);
    });

    const toUnload: string[] = [];
    prepsByMachine.forEach((preps, machineId) => {
      // Trouver la date du dernier événement pour cette machine
      const lastEventDate = new Date(Math.max(...preps.map(p => p.dateEvenement.getTime())));
      lastEventDate.setHours(0, 0, 0, 0);

      // Si le dernier événement est passé (< aujourd'hui), passer toutes les preps en "a_decharger"
      if (lastEventDate < today) {
        preps.forEach(p => toUnload.push(p.id));
      }
    });

    if (toUnload.length > 0) {
      await prisma.preparation.updateMany({
        where: { id: { in: toUnload } },
        data: { statut: 'a_decharger' },
      });
      console.log(`[Auto-Prep] ${toUnload.length} préparation(s) "en_cours" passée(s) en "a_decharger"`);
    }
  } catch (error) {
    console.error('[Auto-Prep] Erreur:', error);
  }
}

/**
 * Liste toutes les préparations
 */
export const listPreparations = async (req: Request, res: Response) => {
  try {
    const { statut, machineId, client, archived } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Filtre par statut (actives par défaut)
    if (archived === 'true') {
      where.statut = 'archivee';
    } else if (statut) {
      where.statut = statut as PreparationStatut;
    } else {
      // Par défaut, exclure les archivées
      where.statut = {
        not: 'archivee',
      };
    }

    if (machineId) where.machineId = machineId;
    if (client) {
      where.client = {
        contains: client as string,
        mode: 'insensitive',
      };
    }

    const [preparations, total] = await Promise.all([
      prisma.preparation.findMany({
        where,
        include: {
          machine: true,
        },
        orderBy: {
          dateEvenement: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.preparation.count({ where }),
    ]);

    return res.json({
      data: preparations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing preparations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Récupère une préparation par ID
 */
export const getPreparation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const preparation = await prisma.preparation.findUnique({
      where: { id },
      include: {
        machine: true,
      },
    });

    if (!preparation) {
      return res.status(404).json({ error: 'Preparation not found' });
    }

    return res.json(preparation);
  } catch (error) {
    console.error('Error fetching preparation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Crée une nouvelle préparation
 */
export const createPreparation = async (req: Request, res: Response) => {
  try {
    const { machineId, dateEvenement, client, preparateur, notes, pendingPointId } = req.body;

    // Validation
    if (!machineId || !dateEvenement || !client || !preparateur) {
      return res.status(400).json({
        error: 'Missing required fields: machineId, dateEvenement, client, preparateur',
      });
    }

    // Vérifier que la machine existe
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    // Créer la préparation directement en statut "prete"
    const preparation = await prisma.preparation.create({
      data: {
        machineId,
        dateEvenement: new Date(dateEvenement),
        client,
        preparateur,
        notes,
        pendingPointId: pendingPointId || null,
        statut: 'prete',
      },
      include: {
        machine: true,
      },
    });

    // Notifier tous les admins en temps réel via Socket.io
    const machineName = `${preparation.machine.type} ${preparation.machine.numero}`;
    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('preparation:created', {
      id: preparation.id,
      machine: machineName,
      client,
      dateEvenement,
      preparateur,
      createdAt: preparation.createdAt,
    });
    socketEmit.toAdmins('machines:updated', {});

    // Persister la notification en base pour tous les admins
    const { createForAdmins } = await import('./notification.controller.js');
    const dateEvtStr = new Date(dateEvenement).toLocaleDateString('fr-FR');
    createForAdmins(req.user?.tenantId || null, {
      type: 'preparation_created',
      title: 'Nouvelle préparation',
      body: `${machineName} préparée pour ${client}`,
      metadata: { client, dateEvenement: dateEvtStr, machine: machineName, preparateur },
    }).catch((err: any) => console.error('Erreur création notif DB:', err));

    return res.status(201).json(preparation);
  } catch (error) {
    console.error('Error creating preparation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Met à jour une préparation
 */
export const updatePreparation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { statut, photosDechargees, notes, dateEvenement, client, preparateur } = req.body;

    const updateData: any = {};
    if (statut !== undefined) updateData.statut = statut;
    if (photosDechargees !== undefined) updateData.photosDechargees = photosDechargees;
    if (notes !== undefined) updateData.notes = notes;
    if (dateEvenement !== undefined) updateData.dateEvenement = new Date(dateEvenement);
    if (client !== undefined) updateData.client = client;
    if (preparateur !== undefined) updateData.preparateur = preparateur;

    // Si on archive, ajouter la date d'archivage
    if (statut === 'archivee') {
      updateData.dateArchivage = new Date();
    }

    const preparation = await prisma.preparation.update({
      where: { id },
      data: updateData,
      include: {
        machine: true,
      },
    });

    // Notifier les admins des changements de statut
    if (statut) {
      const machineName = `${preparation.machine.type} ${preparation.machine.numero}`;
      const statutLabels: Record<string, string> = {
        prete: 'prête', en_cours: 'en cours', a_decharger: 'à décharger',
        archivee: 'archivée', defaut: 'en défaut', hors_service: 'hors service',
      };
      const { socketEmit } = await import('../config/socket.js');
      socketEmit.toAdmins('preparation:updated', {
        id: preparation.id,
        machine: machineName,
        client: preparation.client,
        statut,
        preparateur: preparation.preparateur,
        updatedAt: preparation.updatedAt,
      });
      socketEmit.toAdmins('machines:updated', {});

      // Persister la notification en base
      const { createForAdmins } = await import('./notification.controller.js');
      createForAdmins(req.user?.tenantId || null, {
        type: 'preparation_updated',
        title: 'Mise à jour',
        body: `${machineName} (${preparation.client}) → ${statutLabels[statut] || statut}`,
        metadata: {
          client: preparation.client,
          machine: machineName,
          statut: statutLabels[statut] || statut,
          preparateur: preparation.preparateur,
        },
      }).catch((err: any) => console.error('Erreur création notif DB:', err));
    }

    return res.json(preparation);
  } catch (error) {
    console.error('Error updating preparation:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Supprime une préparation
 */
export const deletePreparation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Récupérer la préparation pour savoir si elle a un pendingPointId
    const preparation = await prisma.preparation.findUnique({
      where: { id },
      select: { pendingPointId: true },
    });

    if (!preparation) {
      return res.status(404).json({ error: 'Preparation not found' });
    }

    // Récupérer les infos de la machine avant suppression pour la notif
    const fullPrep = await prisma.preparation.findUnique({
      where: { id },
      include: { machine: true },
    });

    // Supprimer la préparation
    await prisma.preparation.delete({
      where: { id },
    });

    // Remettre le pending point comme disponible
    if (preparation.pendingPointId) {
      try {
        const point = await prisma.pendingPoint.update({
          where: { id: preparation.pendingPointId },
          data: { usedInPreparation: false },
        });
        // Remettre aussi le point associé (livraison/ramassage)
        if (point.externalId) {
          const eventIdBase = point.externalId.replace(/_livraison$/, '').replace(/_ramassage$/, '');
          await prisma.pendingPoint.updateMany({
            where: {
              externalId: { startsWith: eventIdBase },
              usedInPreparation: true,
            },
            data: { usedInPreparation: false },
          });
        }
      } catch (e) {
        console.error('Error restoring pending point:', e);
      }
    }

    // Notifier les admins en temps réel
    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});
    if (fullPrep) {
      const machineName = `${fullPrep.machine.type} ${fullPrep.machine.numero}`;
      const { createForAdmins } = await import('./notification.controller.js');
      createForAdmins(req.user?.tenantId || null, {
        type: 'preparation_updated',
        title: 'Préparation annulée',
        body: `${machineName} (${fullPrep.client}) — annulée`,
        metadata: {
          client: fullPrep.client,
          machine: machineName,
          statut: 'annulée',
          preparateur: fullPrep.preparateur,
        },
      }).catch((err: any) => console.error('Erreur création notif DB:', err));
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting preparation:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Marque une préparation comme prête
 */
export const markAsReady = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const preparation = await prisma.preparation.update({
      where: { id },
      data: { statut: 'prete' },
      include: {
        machine: true,
      },
    });

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking preparation as ready:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Marque les photos comme déchargées
 * + envoie automatiquement le mail d'avis (URL unique) au client
 */
export const markPhotosUnloaded = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const preparation = await prisma.preparation.update({
      where: { id },
      data: {
        photosDechargees: true,
        statut: 'archivee',
        dateArchivage: new Date(),
      },
      include: {
        machine: true,
      },
    });

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    // Auto-send review link email to matching booking
    triggerReviewEmailForPreparation(preparation).catch(err => {
      console.error('[PhotosUnloaded] Failed to trigger review email:', err);
    });

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking photos as unloaded:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Marque les photos comme NON déchargées (problème)
 * + flag le booking correspondant pour alerte dans galeries clients
 */
export const markPhotosNotUnloaded = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const preparation = await prisma.preparation.update({
      where: { id },
      data: {
        photosDechargees: false,
        statut: 'archivee',
        dateArchivage: new Date(),
      },
      include: {
        machine: true,
      },
    });

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    // Flag the matching booking
    flagBookingPhotosNotUnloaded(preparation).catch(err => {
      console.error('[PhotosNotUnloaded] Failed to flag booking:', err);
    });

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking photos as not unloaded:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Find matching booking and flag photosNotUnloaded = true
 */
async function flagBookingPhotosNotUnloaded(preparation: any): Promise<void> {
  let booking = null;

  // Match via pendingPoint → googleEventId
  if (preparation.pendingPointId) {
    const pendingPoint = await prisma.pendingPoint.findUnique({
      where: { id: preparation.pendingPointId },
    });
    if (pendingPoint?.externalId) {
      booking = await prisma.booking.findUnique({
        where: { googleEventId: pendingPoint.externalId },
      });
    }
  }

  // Fallback: fuzzy name + date
  if (!booking) {
    booking = await prisma.booking.findFirst({
      where: {
        customerName: preparation.client,
        eventDate: preparation.dateEvenement,
      },
    });
  }
  if (!booking) {
    const candidates = await prisma.booking.findMany({
      where: { eventDate: preparation.dateEvenement },
    });
    const prepName = preparation.client.toLowerCase().trim();
    booking = candidates.find(b => {
      const bookingName = b.customerName.toLowerCase().trim();
      return prepName.includes(bookingName) || bookingName.includes(prepName);
    }) || null;
  }

  if (!booking) {
    console.log(`[PhotosNotUnloaded] No matching booking for "${preparation.client}"`);
    return;
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { photosNotUnloaded: true },
  });

  console.log(`[PhotosNotUnloaded] Flagged booking "${booking.customerName}" as photos not unloaded`);
}

/**
 * Find the matching booking for a preparation and send the review link email.
 * Brand routing: Vegas/Ring → SHOOTNBOX, Smakk → SMAKK
 */
async function triggerReviewEmailForPreparation(preparation: any): Promise<void> {
  const { sendReviewLinkEmail } = await import('../services/email.service.js');
  const { config } = await import('../config/index.js');

  // Determine brand from machine type
  const machineType: string = preparation.machine?.type || '';
  const brand: 'SHOOTNBOX' | 'SMAKK' = machineType === 'Smakk' ? 'SMAKK' : 'SHOOTNBOX';

  // Find matching booking via pendingPoint → externalId → booking.googleEventId
  let booking = null;

  if (preparation.pendingPointId) {
    const pendingPoint = await prisma.pendingPoint.findUnique({
      where: { id: preparation.pendingPointId },
    });

    if (pendingPoint?.externalId) {
      booking = await prisma.booking.findUnique({
        where: { googleEventId: pendingPoint.externalId },
      });
    }
  }

  // Fallback: match by event date + fuzzy name matching
  if (!booking) {
    // First try exact match
    booking = await prisma.booking.findFirst({
      where: {
        customerName: preparation.client,
        eventDate: preparation.dateEvenement,
      },
    });

    // If no exact match, fuzzy match: one name contains the other
    if (!booking) {
      const candidates = await prisma.booking.findMany({
        where: { eventDate: preparation.dateEvenement },
      });

      const prepName = preparation.client.toLowerCase().trim();
      booking = candidates.find(b => {
        const bookingName = b.customerName.toLowerCase().trim();
        // Either the booking name is part of the prep name, or vice versa
        return prepName.includes(bookingName) || bookingName.includes(prepName);
      }) || null;

      if (booking) {
        console.log(`[PhotosUnloaded] Fuzzy matched: prep="${preparation.client}" → booking="${booking.customerName}"`);
      }
    }
  }

  if (!booking) {
    console.log(`[PhotosUnloaded] No matching booking found for preparation "${preparation.client}" (${preparation.id})`);
    return;
  }

  if (!booking.customerEmail) {
    console.log(`[PhotosUnloaded] Booking "${booking.customerName}" has no email, skipping`);
    return;
  }

  // Check if review email was already sent
  if (booking.emailSentAt) {
    console.log(`[PhotosUnloaded] Email already sent for booking "${booking.customerName}", skipping`);
    return;
  }

  // Build public URL with brand
  const publicUrl = `${config.reviewSystem.publicBaseUrl}/galerie/${booking.publicToken}?brand=${brand}`;

  // Update booking brand if not set
  if (!booking.senderBrand) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { senderBrand: brand },
    });
  }

  // Send review link email
  await sendReviewLinkEmail({
    to: booking.customerEmail,
    customerName: booking.customerName,
    publicUrl,
    galleryUrl: booking.galleryUrl,
    brand,
  });

  // Mark email as sent
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      emailSentAt: new Date(),
      status: booking.status === 'link_sent' || booking.status === 'page_viewed'
        ? 'link_sent'
        : booking.status,
    },
  });

  console.log(`[PhotosUnloaded] Review email sent to ${booking.customerEmail} via ${brand} for "${booking.customerName}"`);
}

/**
 * Marque une machine avec un défaut
 */
export const markMachineDefect = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { defaut } = req.body;

    if (!defaut || typeof defaut !== 'string') {
      return res.status(400).json({ error: 'Description du défaut requise' });
    }

    // Récupérer la préparation pour obtenir l'ID de la machine
    const preparation = await prisma.preparation.findUnique({
      where: { id },
      select: { machineId: true },
    });

    if (!preparation) {
      return res.status(404).json({ error: 'Preparation not found' });
    }

    // Mettre à jour la machine avec le défaut
    const machine = await prisma.machine.update({
      where: { id: preparation.machineId },
      data: {
        aDefaut: true,
        defaut,
      },
      include: {
        preparations: {
          where: {
            statut: {
              in: ['en_preparation', 'prete', 'en_cours', 'a_decharger'],
            },
          },
          orderBy: {
            dateEvenement: 'desc',
          },
          take: 1,
        },
      },
    });

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(machine);
  } catch (error) {
    console.error('Error marking machine defect:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation or machine not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Marque une préparation comme hors service
 */
export const markOutOfService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { raison } = req.body;

    if (!raison || typeof raison !== 'string') {
      return res.status(400).json({ error: 'Raison requise' });
    }

    const preparation = await prisma.preparation.update({
      where: { id },
      data: {
        statut: 'hors_service',
        notes: raison,
      },
      include: {
        machine: true,
      },
    });

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking out of service:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
