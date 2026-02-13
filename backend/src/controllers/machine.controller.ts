import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { MachineType } from '@prisma/client';
import { uploadToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js';

/**
 * Liste toutes les machines
 */
export const listMachines = async (req: Request, res: Response) => {
  try {
    const { type, actif } = req.query;

    const where: any = {};
    if (type) where.type = type as MachineType;
    if (actif !== undefined) where.actif = actif === 'true';

    const machines = await prisma.machine.findMany({
      where,
      orderBy: [
        { type: 'asc' },
        { numero: 'asc' },
      ],
      include: {
        preparations: {
          where: {
            statut: {
              in: ['en_preparation', 'prete', 'en_cours', 'a_decharger', 'hors_service'],
            },
          },
          orderBy: {
            dateEvenement: 'desc',
          },
          take: 1,
        },
      },
    });

    return res.json(machines);
  } catch (error) {
    console.error('Error listing machines:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Récupère une machine par ID
 */
export const getMachine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const machine = await prisma.machine.findUnique({
      where: { id },
      include: {
        preparations: {
          orderBy: {
            dateEvenement: 'desc',
          },
        },
      },
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    return res.json(machine);
  } catch (error) {
    console.error('Error fetching machine:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Upload une image pour un type de machine
 * L'image sera appliquée à toutes les machines de ce type
 */
export const uploadMachineImage = async (req: Request, res: Response) => {
  try {
    const type = req.params.type as string;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    if (!type) {
      return res.status(400).json({ error: 'Type de machine manquant' });
    }

    // Vérifier que le type est valide
    if (!['Vegas', 'Smakk', 'Ring'].includes(type)) {
      return res.status(400).json({ error: 'Type de machine invalide' });
    }

    // Vérifier que Cloudinary est configuré
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        error: 'Service d\'upload non configuré. Contactez l\'administrateur.',
      });
    }

    // Upload vers Cloudinary
    const { url } = await uploadToCloudinary(file.buffer, `machines/${type}`);

    // Mettre à jour toutes les machines de ce type avec la nouvelle image
    const result = await prisma.machine.updateMany({
      where: { type: type as MachineType },
      data: { imageUrl: url },
    });

    return res.json({
      imageUrl: url,
      updatedCount: result.count,
      message: `Image mise à jour pour ${result.count} machine(s) ${type}`,
    });
  } catch (error) {
    console.error('Error uploading machine image:', error);
    return res.status(500).json({ error: 'Erreur lors de l\'upload de l\'image' });
  }
};
