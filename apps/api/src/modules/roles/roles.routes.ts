import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, requireAuth } from '../../shared/request-context';
import { createRoleSchema, updateRoleSchema } from './roles.schemas';
import * as rolesService from './roles.service';

const controller = {
  async list(_req: Request, res: Response) {
    res.json({ roles: await rolesService.listRoles() });
  },
  async get(req: Request, res: Response) {
    res.json({ role: await rolesService.getRole(uuidParam(req)) });
  },
  async create(req: Request, res: Response) {
    const dto = createRoleSchema.parse(req.body);
    res.status(201).json({ role: await rolesService.createRole(requireAuth(req), dto, clientInfo(req)) });
  },
  async update(req: Request, res: Response) {
    const dto = updateRoleSchema.parse(req.body);
    res.json({ role: await rolesService.updateRole(requireAuth(req), uuidParam(req), dto, clientInfo(req)) });
  },
  async remove(req: Request, res: Response) {
    await rolesService.deleteRole(requireAuth(req), uuidParam(req), clientInfo(req));
    res.status(204).end();
  },
  permissions(_req: Request, res: Response) {
    res.json({ groups: rolesService.listPermissionGroups() });
  },
};

export function rolesRouter(): Router {
  const router = Router();
  router.use(authenticate);

  // Consultar roles es necesario para asignarlos a usuarios
  router.get('/', authorize('users.view'), controller.list);
  router.get('/:id', authorize('users.view'), controller.get);
  router.post('/', authorize('roles.manage'), controller.create);
  router.patch('/:id', authorize('roles.manage'), controller.update);
  router.delete('/:id', authorize('roles.manage'), controller.remove);

  return router;
}

export function permissionsRouter(): Router {
  const router = Router();
  router.get('/', authenticate, authorize('users.view'), controller.permissions);
  return router;
}
