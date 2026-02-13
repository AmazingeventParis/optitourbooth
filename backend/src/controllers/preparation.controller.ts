import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { PreparationStatut } from '@prisma/client';

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

    res.json({
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

    res.json(preparation);
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

    // Créer la préparation
    const preparation = await prisma.preparation.create({
      data: {
        machineId,
        dateEvenement: new Date(dateEvenement),
        client,
        preparateur,
        notes,
        statut: 'en_preparation',
      },
      include: {
        machine: true,
      },
    });

    res.status(201).json(preparation);
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

    res.json(preparation);
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

    res.status(204).send();
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

    res.json(preparation);
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

    res.json(preparation);
  } catch (error) {
    console.error('Error marking photos as unloaded:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Preparation not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
