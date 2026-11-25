import { Hono, type Context } from 'hono';
import type { Actor } from '../model/actor';
import { DatosNoValidosError } from '../model/password';
import { ProyectoNoEncontradoError, type DatosProyecto, type Proyecto } from '../model/project';
import { FichaNoEncontradaError } from '../model/student-profile';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface ProjectRoutesDeps extends AuthMiddlewareDeps {
  projects: {
    list(actor: Actor): Promise<Proyecto[]>;
    create(actor: Actor, input: DatosProyecto): Promise<Proyecto>;
    update(actor: Actor, id: string, input: DatosProyecto): Promise<Proyecto>;
    remove(actor: Actor, id: string): Promise<void>;
  };
}

/** Proyectos propios del alumno (montar bajo /api/students/me/projects). Solo ALUMNO. */
export function createProjectRoutes(deps: ProjectRoutesDeps) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(deps, ['ALUMNO']));

  const errores = (e: unknown, c: Context) => {
    if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
    if (e instanceof ProyectoNoEncontradoError || e instanceof FichaNoEncontradaError) {
      return c.json({ error: e.message }, 404);
    }
    throw e;
  };
  const cuerpo = async (c: Context) => {
    const b = await c.req.json().catch(() => null);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as DatosProyecto) : null;
  };

  app.get('/', async (c) => {
    try {
      return c.json(await deps.projects.list(getActor(c)));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.post('/', async (c) => {
    const b = await cuerpo(c);
    if (!b) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.projects.create(getActor(c), b), 201);
    } catch (e) {
      return errores(e, c);
    }
  });

  app.put('/:id', async (c) => {
    const b = await cuerpo(c);
    if (!b) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.projects.update(getActor(c), c.req.param('id'), b));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.delete('/:id', async (c) => {
    try {
      await deps.projects.remove(getActor(c), c.req.param('id'));
      return c.body(null, 204);
    } catch (e) {
      return errores(e, c);
    }
  });

  return app;
}
