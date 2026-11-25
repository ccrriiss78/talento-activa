import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Actor } from '../model/actor';
import type { CambiosEdicion, Edition, NuevaEdicion } from '../model/edition';
import { EdicionCerradaError, EdicionNoEncontradaError } from '../model/edition';
import { DatosNoValidosError } from '../model/password';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface EditionRoutesDeps extends AuthMiddlewareDeps {
  editions: {
    create(actor: Actor, input: NuevaEdicion): Promise<Edition>;
    list(): Promise<Edition[]>;
    get(id: string): Promise<Edition | null>;
    update(actor: Actor, id: string, input: CambiosEdicion): Promise<Edition>;
    close(actor: Actor, id: string): Promise<Edition>;
  };
}

const CAMPOS = ['nombre', 'anio', 'fecha_inicio', 'fecha_fin'] as const;

/** Copia solo los campos editables conocidos (ignora estado, id, etc.). */
function pick(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS) if (k in src) out[k] = src[k];
  return out;
}

function errorResponse(c: Context, e: unknown) {
  if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
  if (e instanceof EdicionNoEncontradaError) return c.json({ error: e.message }, 404);
  if (e instanceof EdicionCerradaError) return c.json({ error: e.message }, 409);
  throw e;
}

/** Rutas de ediciones (montar bajo /api/editions). Solo ADMIN. */
export function createEditionRoutes(deps: EditionRoutesDeps) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(deps, ['ADMIN']));

  app.post('/', async (c) => {
    const input = pick(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.editions.create(getActor(c), input as unknown as NuevaEdicion), 201);
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  app.get('/', async (c) => c.json(await deps.editions.list()));

  app.get('/:id', async (c) => {
    const e = await deps.editions.get(c.req.param('id'));
    return e ? c.json(e) : c.json({ error: 'Edición no encontrada' }, 404);
  });

  app.patch('/:id', async (c) => {
    const input = pick(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: 'Datos no válidos' }, 400);
    try {
      return c.json(await deps.editions.update(getActor(c), c.req.param('id'), input as CambiosEdicion));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  app.post('/:id/close', async (c) => {
    try {
      return c.json(await deps.editions.close(getActor(c), c.req.param('id')));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  return app;
}
