import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { PreparationStatut } from '@prisma/client';

/**
 * Auto-transition des statuts de préparation selon la date
 */
async function autoUpdatePreparationStatuses(): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

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

    // 2. Passer "en_cours" → "a_decharger" le lendemain du dernier événement
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
      console.log(`[Auto-Prep] ${toUnload.length} préparation(s) passée(s) en "a_decharger"`);
    }
  } catch (error) {
    console.error('[Auto-Prep] Erreur:', error);
  }
}

/**
 * Liste toutes les préparations
 */
export const listPreparations = async (req: Request, res: Response) => {
  // Auto-transition des statuts selon la date
  await autoUpdatePreparationStatuses();
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
    const { machineId, dateEvenement, client, preparateur, notes } = req.body;

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

    // Vérifier qu'il n'y a pas déjà une préparation active pour cette machine
    const existingPreparation = await prisma.preparation.findFirst({
      where: {
        machineId,
        statut: {
          in: ['en_preparation', 'prete', 'en_cours', 'a_decharger'],
        },
      },
    });

    if (existingPreparation) {
      return res.status(409).json({
        error: 'Cette machine a déjà une préparation active',
        preparation: existingPreparation,
      });
    }

    // Créer la préparation directement en statut "prete"
    const preparation = await prisma.preparation.create({
      data: {
        machineId,
        dateEvenement: new Date(dateEvenement),
        client,
        preparateur,
        notes,
        statut: 'prete',
      },
      include: {
        machine: true,
      },
    });

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

    await prisma.preparation.delete({
      where: { id },
    });

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

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking out of service:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
