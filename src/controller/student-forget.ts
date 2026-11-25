import { Hono, type Context } from 'hono';
import type { Actor } from '../model/actor';
import { FichaNoEncontradaError } from '../model/student-profile';
import { clearSessionCookie } from './cookie';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface StudentForgetRoutesDeps extends AuthMiddlewareDeps {
  forgetter: { forget(actor: Actor, studentId?: string): Promise<void> };
}

/** Derecho al olvido (montar bajo /api/students). */
export function createStudentForgetRoutes(deps: StudentForgetRoutesDeps) {
  const app = new Hono();

  const errores = (e: unknown, c: Context) => {
    if (e instanceof FichaNoEncontradaError) return c.json({ error: e.message }, 404);
    throw e;
  };

  app.delete('/me', createAuthMiddleware(deps, ['ALUMNO']), async (c) => {
    try {
      await deps.forgetter.forget(getActor(c));
    } catch (e) {
      return errores(e, c);
    }
    c.header('Set-Cookie', clearSessionCookie(deps.cookie));
    return c.body(null, 204);
  });

  app.delete('/:id', createAuthMiddleware(deps, ['ADMIN']), async (c) => {
    try {
      await deps.forgetter.forget(getActor(c), c.req.param('id'));
    } catch (e) {
      return errores(e, c);
    }
    return c.body(null, 204);
  });

  return app;
}
