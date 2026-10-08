import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, requireAuth } from '../../shared/request-context';
import {
  createCatalogItem,
  deleteCatalogItem,
  listCatalog,
  updateCatalogItem,
  type CatalogKind,
} from './catalogs.service';

/** /categories y /laboratories comparten rutas y permisos. */
export function catalogRouter(kind: CatalogKind): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('products.view'), async (_req, res) => {
    res.json({ items: await listCatalog(kind) });
  });
  router.post('/', authorize('catalogs.manage'), async (req, res) => {
    res.status(201).json({ item: await createCatalogItem(kind, requireAuth(req), req.body, clientInfo(req)) });
  });
  router.patch('/:id', authorize('catalogs.manage'), async (req, res) => {
    res.json({ item: await updateCatalogItem(kind, requireAuth(req), uuidParam(req), req.body, clientInfo(req)) });
  });
  router.delete('/:id', authorize('catalogs.manage'), async (req, res) => {
    await deleteCatalogItem(kind, requireAuth(req), uuidParam(req), clientInfo(req));
    res.status(204).end();
  });

  return router;
}
