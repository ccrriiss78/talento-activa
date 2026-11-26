import { Hono } from 'hono';
import type { Actor } from '../model/actor';
import { EdicionNoEncontradaError } from '../model/edition';
import { DatosNoValidosError } from '../model/password';
import type { NuevoAlumno, Student } from '../model/student';
import { EmailYaRegistradoError } from '../model/user';
import { notificarVerificacion, type VerificationNotifyDeps } from './verification-notify';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface StudentRoutesDeps extends AuthMiddlewareDeps, VerificationNotifyDeps {
  students: { create(actor: Actor, input: NuevoAlumno): Promise<Student> };
}

/** Rutas de alumnos (montar bajo /api/students). Alta solo ADMIN. */
export function createStudentRoutes(deps: StudentRoutesDeps) {
  const app = new Hono();
  // Middleware por ruta (no `use('*')`): este prefijo lo comparten otros routers con otros roles.
  app.post('/', createAuthMiddleware(deps, ['ADMIN']), async (c) => {
    const b = await c.req.json().catch(() => null);
    if (
      !b ||
      typeof b !== 'object' ||
      typeof b.email !== 'string' ||
      typeof b.password !== 'string' ||
      typeof b.edition_id !== 'string' ||
      typeof b.nombre !== 'string'
    ) {
      return c.json({ error: 'Datos no válidos' }, 400);
    }
    const input: NuevoAlumno = {
      email: b.email,
      password: b.password,
      edition_id: b.edition_id,
      nombre: b.nombre,
    };
    try {
      const alumno = await deps.students.create(getActor(c), input);
      await notificarVerificacion(deps, { id: alumno.user_id, email: input.email });
      return c.json(alumno, 201);
    } catch (e) {
      if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
      if (e instanceof EdicionNoEncontradaError) return c.json({ error: e.message }, 404);
      if (e instanceof EmailYaRegistradoError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  return app;
}
