import type { Request, Response } from 'express';
import { uuidParam } from '../../shared/params';
import { clientInfo, requireAuth } from '../../shared/request-context';
import {
  adminResetPasswordSchema,
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
} from './users.schemas';
import * as usersService from './users.service';

export async function list(req: Request, res: Response) {
  res.json(await usersService.listUsers(listUsersSchema.parse(req.query)));
}

export async function get(req: Request, res: Response) {
  res.json({ user: await usersService.getUser(uuidParam(req)) });
}

export async function create(req: Request, res: Response) {
  const dto = createUserSchema.parse(req.body);
  const result = await usersService.createUser(requireAuth(req), dto, clientInfo(req));
  // La contraseña temporal se muestra UNA vez para entregarla al usuario
  res.status(201).json(result);
}

export async function update(req: Request, res: Response) {
  const dto = updateUserSchema.parse(req.body);
  res.json({ user: await usersService.updateUser(requireAuth(req), uuidParam(req), dto, clientInfo(req)) });
}

export async function deactivate(req: Request, res: Response) {
  res.json({ user: await usersService.setUserStatus(requireAuth(req), uuidParam(req), 'INACTIVE', clientInfo(req)) });
}

export async function activate(req: Request, res: Response) {
  res.json({ user: await usersService.setUserStatus(requireAuth(req), uuidParam(req), 'ACTIVE', clientInfo(req)) });
}

export async function resetPassword(req: Request, res: Response) {
  const dto = adminResetPasswordSchema.parse(req.body ?? {});
  res.json(await usersService.adminResetPassword(requireAuth(req), uuidParam(req), dto, clientInfo(req)));
}

export async function unlock(req: Request, res: Response) {
  res.json({ user: await usersService.unlockUser(requireAuth(req), uuidParam(req), clientInfo(req)) });
}

export async function revokeSessions(req: Request, res: Response) {
  res.json(await usersService.revokeSessions(requireAuth(req), uuidParam(req), clientInfo(req)));
}
