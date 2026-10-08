import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';

/** Sucursales activas (para asignarlas a usuarios). La administración de sucursales llega con multi-sucursal. */
export function branchesRouter(): Router {
  const router = Router();
  router.get('/', authenticate, authorize('users.view'), async (_req, res) => {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ branches });
  });
  return router;
}
