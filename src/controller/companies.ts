import { Hono } from 'hono';
import type { Actor } from '../model/actor';
import type { Company, NuevaEmpresa } from '../model/company';
import { EmpresaNoEncontradaError } from '../model/company';
import { DatosNoValidosError } from '../model/password';
import { EmailYaRegistradoError } from '../model/user';
import { createAuthMiddleware, getActor, type AuthMiddlewareDeps } from './authorization';

export interface CompanyRoutesDeps extends AuthMiddlewareDeps {
  companies: {
    create(actor: Actor, input: NuevaEmpresa): Promise<Company>;
    setSocia(actor: Actor, id: string, esSocia: boolean): Promise<Company>;
  };
}

/** Rutas de empresas (montar bajo /api/companies). Solo ADMIN. */
export function createCompanyRoutes(deps: CompanyRoutesDeps) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(deps, ['ADMIN']));

  app.post('/', async (c) => {
    const b = await c.req.json().catch(() => null);
    if (
      !b ||
      typeof b !== 'object' ||
      typeof b.email !== 'string' ||
      typeof b.password !== 'string' ||
      typeof b.nombre !== 'string'
    ) {
      return c.json({ error: 'Datos no válidos' }, 400);
    }
    const input: NuevaEmpresa = { email: b.email, password: b.password, nombre: b.nombre };
    if (b.es_socia !== undefined) input.es_socia = b.es_socia;
    if (b.contacto !== undefined) input.contacto = b.contacto;
    try {
      return c.json(await deps.companies.create(getActor(c), input), 201);
    } catch (e) {
      if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
      if (e instanceof EmailYaRegistradoError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  app.patch('/:id/socia', async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== 'object' || typeof b.es_socia !== 'boolean') {
      return c.json({ error: 'Datos no válidos' }, 400);
    }
    try {
      return c.json(await deps.companies.setSocia(getActor(c), c.req.param('id'), b.es_socia));
    } catch (e) {
      if (e instanceof EmpresaNoEncontradaError) return c.json({ error: e.message }, 404);
      if (e instanceof DatosNoValidosError) return c.json({ error: 'Datos no válidos' }, 400);
      throw e;
    }
  });

  return app;
}
