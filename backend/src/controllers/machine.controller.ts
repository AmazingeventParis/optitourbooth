import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { MachineType } from '@prisma/client';

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

    res.json(machines);
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

    res.json(machine);
  } catch (error) {
    console.error('Error fetching machine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
