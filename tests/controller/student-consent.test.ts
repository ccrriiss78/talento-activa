import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentConsentRoutes } from '../../src/controller/student-consent';
import { FichaNoEncontradaError } from '../../src/model/student-profile';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });

function setup(rol: string | null, giveOwn = vi.fn(async () => ({ id: 's1', consent_at: 'x' }))) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const app = new Hono();
  app.route('/api/students', createStudentConsentRoutes({ sessions, consent: { giveOwn } as never, cookie: { production: false } }));
  const req = (headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request('/api/students/me/consent', { method: 'PUT', headers });
  return { req, giveOwn };
}

describe('PUT /api/students/me/consent (ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403', async () => {
    expect((await setup(null).req({})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, giveOwn } = setup(rol);
      expect((await req()).status).toBe(403);
      expect(giveOwn).not.toHaveBeenCalled();
    }
  });
  it('el alumno da su consentimiento', async () => {
    const { req, giveOwn } = setup('ALUMNO');
    const r = await req();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 's1', consent_at: 'x' });
    expect(giveOwn).toHaveBeenCalledWith({ id: 'u1', rol: 'ALUMNO' });
  });
  it('ficha inexistente => 404', async () => {
    const { req } = setup('ALUMNO', vi.fn(async () => { throw new FichaNoEncontradaError(); }));
    expect((await req()).status).toBe(404);
  });
});
