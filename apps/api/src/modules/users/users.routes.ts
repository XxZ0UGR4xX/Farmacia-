import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import * as controller from './users.controller';

export function usersRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('users.view'), controller.list);
  router.get('/:id', authorize('users.view'), controller.get);
  router.post('/', authorize('users.manage'), controller.create);
  router.patch('/:id', authorize('users.manage'), controller.update);
  router.post('/:id/deactivate', authorize('users.manage'), controller.deactivate);
  router.post('/:id/activate', authorize('users.manage'), controller.activate);
  router.post('/:id/reset-password', authorize('users.manage'), controller.resetPassword);
  router.post('/:id/unlock', authorize('users.manage'), controller.unlock);
  router.post('/:id/revoke-sessions', authorize('users.manage'), controller.revokeSessions);

  return router;
}
