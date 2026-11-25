import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentSelfRoutes } from '../../src/controller/student-self';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });
const FICHA = { id: 's1', nombre: 'Ana', bio: 'Hola' };

function setup(rol: string | null, over: Partial<{ getOwn: unknown; updateOwn: unknown }> = {}) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const profile = {
    getOwn: vi.fn(async () => FICHA),
    updateOwn: vi.fn(async () => FICHA),
    ...over,
  };
  const app = new Hono();
  app.route('/api/students/me', createStudentSelfRoutes({ sessions, profile: profile as never, cookie: { production: false } }));
  const req = (method: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request('/api/students/me', {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { req, profile };
}

describe('GET/PUT /api/students/me (solo ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403 sin llamar al modelo', async () => {
    expect((await setup(null).req('GET', undefined, {})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, profile } = setup(rol);
      expect((await req('GET')).status).toBe(403);
      expect((await req('PUT', { bio: 'x' })).status).toBe(403);
      expect(profile.getOwn).not.toHaveBeenCalled();
      expect(profile.updateOwn).not.toHaveBeenCalled();
    }
  });

  it('GET devuelve la ficha del actor', async () => {
    const { req, profile } = setup('ALUMNO');
    const r = await req('GET');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(FICHA);
    expect(profile.getOwn).toHaveBeenCalledWith({ id: 'u1', rol: 'ALUMNO' });
  });

  it('PUT pasa el cuerpo al modelo con el Actor y devuelve la ficha', async () => {
    const { req, profile } = setup('ALUMNO');
    const r = await req('PUT', { bio: 'Hola' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(FICHA);
    expect(profile.updateOwn).toHaveBeenCalledWith({ id: 'u1', rol: 'ALUMNO' }, { bio: 'Hola' });
  });

  it.each([undefined, 'texto', [1], null])('PUT con cuerpo %j => 400', async (b) => {
    const { req, profile } = setup('ALUMNO');
    expect((await req('PUT', b as never)).status).toBe(400);
    expect(profile.updateOwn).not.toHaveBeenCalled();
  });

  it('mapea errores: datos no válidos 400, ficha inexistente 404', async () => {
    const bad = setup('ALUMNO', { updateOwn: vi.fn(async () => { throw new DatosNoValidosError(); }) });
    expect((await bad.req('PUT', { bio: 5 })).status).toBe(400);
    const nf = setup('ALUMNO', { getOwn: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await nf.req('GET')).status).toBe(404);
  });
});
