import { Hono, type Context } from 'hono';
import type { Actor } from '../model/actor';
import { DatosNoValidosError } from '../model/password';
import { FichaNoEncontradaError, type Ficha } from '../model/student-profile';
import type { EstadoAlumno } from '../model/student-status';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface StudentStatusRoutesDeps extends AuthMiddlewareDeps {
  status: {
    setEstado(actor: Actor, estado: EstadoAlumno, studentId?: string): Promise<Ficha>;
    getForCompany(actor: Actor, studentId: string): Promise<Record<string, unknown>>;
  };
}

/** Estado activo/inactivo y consulta por empresas (montar bajo /api/students). */
export function createStudentStatusRoutes(deps: StudentStatusRoutesDeps) {
  const app = new Hono();

  const errores = (e: unknown, c: Context) => {
    if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
    if (e instanceof FichaNoEncontradaError) return c.json({ error: e.message }, 404);
    throw e;
  };
  const estadoDe = async (c: Context): Promise<string | null> => {
    const b = await c.req.json().catch(() => null);
    return b && typeof b === 'object' && !Array.isArray(b) && typeof b.estado === 'string' ? b.estado : null;
  };

  app.put('/me/estado', createAuthMiddleware(deps, ['ALUMNO']), async (c) => {
    const estado = await estadoDe(c);
    if (estado === null) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.status.setEstado(getActor(c), estado as EstadoAlumno));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.put('/:id/estado', createAuthMiddleware(deps, ['ADMIN']), async (c) => {
    const estado = await estadoDe(c);
    if (estado === null) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.status.setEstado(getActor(c), estado as EstadoAlumno, c.req.param('id')));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.get('/:id', createAuthMiddleware(deps, ['SOCIO']), async (c) => {
    try {
      return c.json(await deps.status.getForCompany(getActor(c), c.req.param('id')));
    } catch (e) {
      return errores(e, c);
    }
  });

  return app;
}
