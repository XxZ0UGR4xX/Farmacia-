import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { getCatalogDefaults } from './settings.service';

export function settingsRouter(): Router {
  const router = Router();
  router.use(authenticate);
  // Valores predeterminados para capturar productos (margen, IVA, stock mínimo, moneda)
  router.get('/defaults', authorize('products.view'), async (_req, res) => {
    res.json(await getCatalogDefaults());
  });
  return router;
}
