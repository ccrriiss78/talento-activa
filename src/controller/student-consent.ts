import { Hono } from 'hono';
import type { Actor } from '../model/actor';
import { FichaNoEncontradaError } from '../model/student-profile';
import type { ConsentimientoAlumno } from '../model/student-consent';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface StudentConsentRoutesDeps extends AuthMiddlewareDeps {
  consent: { giveOwn(actor: Actor): Promise<ConsentimientoAlumno> };
}

/** Consentimiento explícito del alumno (montar bajo /api/students). Solo ALUMNO. */
export function createStudentConsentRoutes(deps: StudentConsentRoutesDeps) {
  const app = new Hono();
  app.put('/me/consent', createAuthMiddleware(deps, ['ALUMNO']), async (c) => {
    try {
      return c.json(await deps.consent.giveOwn(getActor(c)));
    } catch (e) {
      if (e instanceof FichaNoEncontradaError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });
  return app;
}
