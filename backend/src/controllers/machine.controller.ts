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
            dateEvenement: 'asc',
          },
        },
        suggestedPoints: {
          where: {
            usedInPreparation: false,
            ignoredInPreparation: false,
            type: 'livraison',
          },
          orderBy: {
            date: 'asc',
          },
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
    if (!['Vegas', 'Smakk', 'Ring', 'Miroir', 'Playbox', 'Aircam', 'Spinner'].includes(type)) {
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

/**
 * Marque une machine comme ayant un défaut
 */
export const markMachineDefect = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { defaut } = req.body;

    if (!defaut || typeof defaut !== 'string') {
      return res.status(400).json({ error: 'Description du défaut requise' });
    }

    const [machine] = await prisma.$transaction([
      prisma.machine.update({
        where: { id },
        data: {
          aDefaut: true,
          defaut,
        },
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
      }),
      prisma.machineIncident.create({
        data: {
          machine: { connect: { id } },
          type: 'defaut',
          description: defaut,
          reportedBy: (req as any).user?.email || null,
        },
      }),
    ]);

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(machine);
  } catch (error) {
    console.error('Error marking machine defect:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Machine not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Marque une machine comme hors service
 */
export const markMachineOutOfService = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { raison } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'ID machine manquant' });
    }

    if (!raison || typeof raison !== 'string') {
      return res.status(400).json({ error: 'Raison requise' });
    }

    // Créer une préparation avec le statut hors_service + incident
    const [preparation] = await prisma.$transaction([
      prisma.preparation.create({
        data: {
          machineId: id as string,
          dateEvenement: new Date(),
          client: 'HORS SERVICE',
          preparateur: 'Système',
          statut: 'hors_service',
          notes: raison,
        },
        include: {
          machine: true,
        },
      }),
      prisma.machineIncident.create({
        data: {
          machine: { connect: { id } },
          type: 'hors_service',
          description: raison,
          reportedBy: (req as any).user?.email || null,
        },
      }),
    ]);

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(preparation);
  } catch (error) {
    console.error('Error marking machine out of service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Liste l'historique des incidents d'une machine
 */
export const listMachineIncidents = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const incidents = await prisma.machineIncident.findMany({
      where: { machineId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json(incidents);
  } catch (error) {
    console.error('Error listing machine incidents:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Retire le défaut d'une machine
 */
export const clearMachineDefect = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Resolve open defaut incidents
    await prisma.machineIncident.updateMany({
      where: { machineId: id, type: 'defaut', resolvedAt: null },
      data: { resolvedAt: new Date() },
    });

    const machine = await prisma.machine.update({
      where: { id },
      data: {
        aDefaut: false,
        defaut: null,
      },
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

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(machine);
  } catch (error) {
    console.error('Error clearing machine defect:', error);
    if ((error as any).code === 'P2025') {
      return res.status(404).json({ error: 'Machine not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Remet une machine en service (archive la préparation hors_service)
 */
export const restoreMachineToService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Trouver la préparation hors_service active de cette machine
    const preparation = await prisma.preparation.findFirst({
      where: {
        machineId: id,
        statut: 'hors_service',
      },
    });

    if (!preparation) {
      return res.status(404).json({ error: 'Aucune préparation hors service trouvée' });
    }

    // Archiver la préparation + résoudre les incidents
    await prisma.preparation.update({
      where: { id: preparation.id },
      data: {
        statut: 'archivee',
        dateArchivage: new Date(),
      },
    });
    await prisma.machineIncident.updateMany({
      where: { machineId: id, type: 'hors_service', resolvedAt: null },
      data: { resolvedAt: new Date() },
    });

    // Retourner la machine mise à jour
    const machine = await prisma.machine.findUnique({
      where: { id },
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

    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});

    return res.json(machine);
  } catch (error) {
    console.error('Error restoring machine to service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
