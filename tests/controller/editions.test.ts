import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createEditionRoutes } from '../../src/controller/editions';
import { EdicionNoEncontradaError, EdicionCerradaError } from '../../src/model/edition';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'admin1', rol }, renewed: false, expiresAt: EXPIRES });
const ED = { id: 'e1', nombre: 'Ed 1', anio: 2026, fecha_inicio: null, fecha_fin: null, estado: 'abierta' };

function setup(rol: string | null, over: Record<string, unknown> = {}) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const editions = {
    create: vi.fn(async () => ED),
    list: vi.fn(async () => [ED]),
    get: vi.fn(async () => ED),
    update: vi.fn(async () => ED),
    close: vi.fn(async () => ({ ...ED, estado: 'cerrada' })),
    ...over,
  };
  const app = new Hono();
  app.route('/api/editions', createEditionRoutes({ sessions, editions: editions as never, cookie: { production: false } }));
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/editions${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { editions, call };
}

describe('/api/editions (solo ADMIN)', () => {
  it.each([
    ['POST', '', { nombre: 'a', anio: 2026 }],
    ['GET', '', undefined],
    ['GET', '/e1', undefined],
    ['PATCH', '/e1', { nombre: 'b' }],
    ['POST', '/e1/close', undefined],
  ] as const)('%s %s: sin sesión => 401 y roles no ADMIN => 403', async (m, p, b) => {
    const anon = setup(null);
    expect((await anon.call(m, p, b, {})).status).toBe(401);
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const { call, editions } = setup(rol);
      expect((await call(m, p, b)).status).toBe(403);
      for (const fn of Object.values(editions)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it('POST crea => 201 y pasa el Actor', async () => {
    const { call, editions } = setup('ADMIN');
    const res = await call('POST', '', { nombre: 'Ed 1', anio: 2026 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(ED);
    expect(editions.create).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, { nombre: 'Ed 1', anio: 2026 });
  });

  it('POST solo reenvía campos conocidos y rechaza body no objeto => 400', async () => {
    const { call, editions } = setup('ADMIN');
    await call('POST', '', { nombre: 'a', anio: 2026, estado: 'cerrada', id: 'x' });
    expect(editions.create).toHaveBeenCalledWith(expect.anything(), { nombre: 'a', anio: 2026 });
    expect((await call('POST', '', 'texto')).status).toBe(400);
  });

  it('DatosNoValidosError => 400', async () => {
    const { call } = setup('ADMIN', {
      create: async () => {
        throw new DatosNoValidosError();
      },
    });
    expect((await call('POST', '', { nombre: '', anio: 1 })).status).toBe(400);
  });

  it('GET lista y GET por id; inexistente => 404', async () => {
    const { call } = setup('ADMIN');
    expect(await (await call('GET', '')).json()).toEqual([ED]);
    expect(await (await call('GET', '/e1')).json()).toEqual(ED);
    const { call: c2 } = setup('ADMIN', { get: async () => null });
    expect((await c2('GET', '/zz')).status).toBe(404);
  });

  it('PATCH actualiza; 404 si no existe; 409 si cerrada', async () => {
    const { call, editions } = setup('ADMIN');
    expect((await call('PATCH', '/e1', { nombre: 'b', estado: 'cerrada' })).status).toBe(200);
    expect(editions.update).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, 'e1', { nombre: 'b' });
    const nf = setup('ADMIN', { update: async () => { throw new EdicionNoEncontradaError(); } });
    expect((await nf.call('PATCH', '/e1', { nombre: 'b' })).status).toBe(404);
    const cl = setup('ADMIN', { update: async () => { throw new EdicionCerradaError(); } });
    expect((await cl.call('PATCH', '/e1', { nombre: 'b' })).status).toBe(409);
  });

  it('POST /:id/close cierra => 200; 404 si no existe', async () => {
    const { call, editions } = setup('ADMIN');
    const res = await call('POST', '/e1/close');
    expect(res.status).toBe(200);
    expect((await res.json()).estado).toBe('cerrada');
    expect(editions.close).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, 'e1');
    const nf = setup('ADMIN', { close: async () => { throw new EdicionNoEncontradaError(); } });
    expect((await nf.call('POST', '/e1/close')).status).toBe(404);
  });

  it('error inesperado => 500', async () => {
    const { call } = setup('ADMIN', { list: async () => { throw new Error('boom'); } });
    expect((await call('GET', '')).status).toBe(500);
  });
});
