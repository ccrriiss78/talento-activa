import { Hono, type Context } from 'hono';
import type { Actor } from '../model/actor';
import { DatosNoValidosError } from '../model/password';
import { FichaNoEncontradaError, type CambiosFicha, type Ficha } from '../model/student-profile';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface StudentSelfRoutesDeps extends AuthMiddlewareDeps {
  profile: {
    getOwn(actor: Actor): Promise<Ficha>;
    updateOwn(actor: Actor, input: CambiosFicha): Promise<Ficha>;
  };
}

/** Ficha propia del alumno (montar bajo /api/students/me). Solo ALUMNO. */
export function createStudentSelfRoutes(deps: StudentSelfRoutesDeps) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(deps, ['ALUMNO']));

  const errores = (e: unknown, c: Context) => {
    if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
    if (e instanceof FichaNoEncontradaError) return c.json({ error: e.message }, 404);
    throw e;
  };

  app.get('/', async (c) => {
    try {
      return c.json(await deps.profile.getOwn(getActor(c)));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.put('/', async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.profile.updateOwn(getActor(c), b as CambiosFicha));
    } catch (e) {
      return errores(e, c);
    }
  });

  return app;
}
