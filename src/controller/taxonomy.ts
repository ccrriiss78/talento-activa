import { Hono, type Context } from 'hono';
import type { Actor } from '../model/actor';
import { DatosNoValidosError } from '../model/password';
import { ElementoNoEncontradoError, type ElementoAlumno, type ElementoCatalogo } from '../model/taxonomy';
import { FichaNoEncontradaError } from '../model/student-profile';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

interface CatalogModel {
  catalog(): Promise<ElementoCatalogo[]>;
  addToCatalog(actor: Actor, nombre: string): Promise<ElementoCatalogo>;
}
interface OwnModel {
  listOwn(actor: Actor): Promise<ElementoAlumno[]>;
  set(actor: Actor, id: string, nivel: string | null): Promise<ElementoAlumno>;
  remove(actor: Actor, id: string): Promise<void>;
}

const errores = (e: unknown, c: Context) => {
  if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
  if (e instanceof ElementoNoEncontradoError || e instanceof FichaNoEncontradaError) return c.json({ error: e.message }, 404);
  throw e;
};
const cuerpo = async (c: Context) => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};

export interface CatalogRoutesDeps extends AuthMiddlewareDeps {
  skills: CatalogModel;
  languages: CatalogModel;
}

/** Catálogo de skills e idiomas (montar bajo /api/catalog). Lectura: cualquier rol; alta: ADMIN. */
export function createCatalogRoutes(deps: CatalogRoutesDeps) {
  const app = new Hono();
  const auth = createAuthMiddleware(deps);
  const soloAdmin = createAuthMiddleware(deps, ['ADMIN']);
  for (const [ruta, modelo] of [['skills', deps.skills], ['languages', deps.languages]] as const) {
    app.get(`/${ruta}`, auth, async (c) => c.json(await modelo.catalog()));
    app.post(`/${ruta}`, soloAdmin, async (c) => {
      const b = await cuerpo(c);
      if (!b) return c.json({ error: 'Datos no válidos' }, 400);
      try {
        return c.json(await modelo.addToCatalog(getActor(c), b.nombre as string), 201);
      } catch (e) {
        return errores(e, c);
      }
    });
  }
  return app;
}

export interface TaxonomyRoutesDeps extends AuthMiddlewareDeps {
  model: OwnModel;
}

/** Skills o idiomas propios del alumno (montar bajo /api/students/me/skills|languages). Solo ALUMNO. */
export function createTaxonomyRoutes(deps: TaxonomyRoutesDeps) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(deps, ['ALUMNO']));

  app.get('/', async (c) => {
    try {
      return c.json(await deps.model.listOwn(getActor(c)));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.put('/:id', async (c) => {
    const b = await cuerpo(c);
    if (!b) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.model.set(getActor(c), c.req.param('id'), (b.nivel ?? null) as string | null));
    } catch (e) {
      return errores(e, c);
    }
  });

  app.delete('/:id', async (c) => {
    try {
      await deps.model.remove(getActor(c), c.req.param('id'));
      return c.body(null, 204);
    } catch (e) {
      return errores(e, c);
    }
  });

  return app;
}
