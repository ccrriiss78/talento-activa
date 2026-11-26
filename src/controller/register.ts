import { Hono } from 'hono';
import type { Actor } from '../model/actor';
import { DatosNoValidosError } from '../model/password';
import { EmailYaRegistradoError, toPublic, type NuevoUsuario, type UserPublic } from '../model/user';
import { notificarVerificacion, type VerificationNotifyDeps } from './verification-notify';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface RegisterDeps extends AuthMiddlewareDeps, VerificationNotifyDeps {
  users: { createUser(actor: Actor, input: NuevoUsuario): Promise<UserPublic> };
}

/** POST /register (montar bajo /api/auth): alta por invitación, solo ADMIN. */
export function createRegisterRoutes(deps: RegisterDeps) {
  const app = new Hono();
  app.post('/register', createAuthMiddleware(deps, ['ADMIN']), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      typeof body.rol !== 'string'
    ) {
      return c.json({ error: 'Datos no válidos' }, 400);
    }
    const input: NuevoUsuario = { email: body.email, password: body.password, rol: body.rol };
    try {
      const user = await deps.users.createUser(getActor(c), input);
      await notificarVerificacion(deps, user);
      return c.json(toPublic(user), 201);
    } catch (e) {
      if (e instanceof EmailYaRegistradoError) return c.json({ error: e.message }, 409);
      if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
      throw e;
    }
  });
  return app;
}
