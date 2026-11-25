import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentForgetRoutes } from '../../src/controller/student-forget';
import { FichaNoEncontradaError } from '../../src/model/student-profile';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });

function setup(rol: string | null, over: Record<string, unknown> = {}) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const forgetter = { forget: vi.fn(async () => {}), ...over };
  const app = new Hono();
  app.route('/api/students', createStudentForgetRoutes({ sessions, forgetter: forgetter as never, cookie: { production: false } }));
  const req = (method: string, path: string, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/students${path}`, { method, headers });
  return { req, forgetter };
}

describe('DELETE /api/students/me (ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403', async () => {
    expect((await setup(null).req('DELETE', '/me', {})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, forgetter } = setup(rol);
      expect((await req('DELETE', '/me')).status).toBe(403);
      expect(forgetter.forget).not.toHaveBeenCalled();
    }
  });
  it('204, limpia la cookie de sesión y olvida al propio alumno', async () => {
    const { req, forgetter } = setup('ALUMNO');
    const r = await req('DELETE', '/me');
    expect(r.status).toBe(204);
    expect(forgetter.forget).toHaveBeenCalledWith({ id: 'u1', rol: 'ALUMNO' });
    const c = r.headers.get('set-cookie') ?? '';
    expect(c).toMatch(/^sesion=;/);
    expect(c).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
  it('ficha inexistente => 404', async () => {
    const { req } = setup('ALUMNO', { forget: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await req('DELETE', '/me')).status).toBe(404);
  });
});

describe('DELETE /api/students/:id (ADMIN)', () => {
  it('SOCIO y ALUMNO 403', async () => {
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const { req, forgetter } = setup(rol);
      expect((await req('DELETE', '/s1')).status).toBe(403);
      expect(forgetter.forget).not.toHaveBeenCalled();
    }
  });
  it('204 y olvida al alumno indicado, sin tocar la cookie del admin', async () => {
    const { req, forgetter } = setup('ADMIN');
    const r = await req('DELETE', '/s1');
    expect(r.status).toBe(204);
    expect(forgetter.forget).toHaveBeenCalledWith({ id: 'u1', rol: 'ADMIN' }, 's1');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('inexistente => 404', async () => {
    const { req } = setup('ADMIN', { forget: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await req('DELETE', '/zz')).status).toBe(404);
  });
});
