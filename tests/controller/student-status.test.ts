import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentStatusRoutes } from '../../src/controller/student-status';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });
const ST = { id: 's1', estado: 'activo' };
const VISTA = { id: 's1', nombre: 'Ana' };

function setup(rol: string | null, over: Record<string, unknown> = {}) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const status = {
    setEstado: vi.fn(async () => ST),
    getForCompany: vi.fn(async () => VISTA),
    ...over,
  };
  const app = new Hono();
  app.route('/api/students', createStudentStatusRoutes({ sessions, status: status as never, cookie: { production: false } }));
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/students${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { req, status };
}

describe('PUT /api/students/me/estado (ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403', async () => {
    expect((await setup(null).req('PUT', '/me/estado', { estado: 'activo' }, {})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, status } = setup(rol);
      expect((await req('PUT', '/me/estado', { estado: 'activo' })).status).toBe(403);
      expect(status.setEstado).not.toHaveBeenCalled();
    }
  });
  it('cambia el estado propio', async () => {
    const { req, status } = setup('ALUMNO');
    const r = await req('PUT', '/me/estado', { estado: 'activo' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(ST);
    expect(status.setEstado).toHaveBeenCalledWith({ id: 'u1', rol: 'ALUMNO' }, 'activo');
  });
  it.each([undefined, 'x', [1], { estado: 5 }, {}])('cuerpo %j => 400', async (b) => {
    const { req, status } = setup('ALUMNO');
    expect((await req('PUT', '/me/estado', b as never)).status).toBe(400);
    expect(status.setEstado).not.toHaveBeenCalled();
  });
  it('mapea errores del modelo', async () => {
    const bad = setup('ALUMNO', { setEstado: vi.fn(async () => { throw new DatosNoValidosError(); }) });
    expect((await bad.req('PUT', '/me/estado', { estado: 'zzz' })).status).toBe(400);
    const nf = setup('ALUMNO', { setEstado: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await nf.req('PUT', '/me/estado', { estado: 'activo' })).status).toBe(404);
  });
});

describe('PUT /api/students/:id/estado (ADMIN)', () => {
  it('SOCIO y ALUMNO 403', async () => {
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const { req, status } = setup(rol);
      expect((await req('PUT', '/s1/estado', { estado: 'inactivo' })).status).toBe(403);
      expect(status.setEstado).not.toHaveBeenCalled();
    }
  });
  it('el admin cambia el estado de un alumno', async () => {
    const { req, status } = setup('ADMIN');
    const r = await req('PUT', '/s1/estado', { estado: 'inactivo' });
    expect(r.status).toBe(200);
    expect(status.setEstado).toHaveBeenCalledWith({ id: 'u1', rol: 'ADMIN' }, 'inactivo', 's1');
  });
});

describe('GET /api/students/:id (SOCIO)', () => {
  it('ADMIN y ALUMNO 403; sin sesión 401', async () => {
    expect((await setup(null).req('GET', '/s1', undefined, {})).status).toBe(401);
    for (const rol of ['ADMIN', 'ALUMNO']) {
      const { req, status } = setup(rol);
      expect((await req('GET', '/s1')).status).toBe(403);
      expect(status.getForCompany).not.toHaveBeenCalled();
    }
  });
  it('el socio obtiene la vista; inactivo => 404', async () => {
    const ok = setup('SOCIO');
    const r = await ok.req('GET', '/s1');
    expect(await r.json()).toEqual(VISTA);
    expect(ok.status.getForCompany).toHaveBeenCalledWith({ id: 'u1', rol: 'SOCIO' }, 's1');
    const nf = setup('SOCIO', { getForCompany: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await nf.req('GET', '/s1')).status).toBe(404);
  });
});
