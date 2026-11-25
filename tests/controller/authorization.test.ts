import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, getActor } from '../../src/controller/authorization';

const EXPIRES = new Date('2030-01-01T00:00:00Z');

function setup(resolved: unknown, roles?: ('ADMIN' | 'SOCIO' | 'ALUMNO')[]) {
  const sessions = { resolve: vi.fn(async () => resolved as never) };
  const app = new Hono();
  app.use('/x', createAuthMiddleware({ sessions, cookie: { production: false } }, roles));
  app.get('/x', (c) => c.json({ actor: getActor(c) }));
  return { sessions, get: (headers: Record<string, string> = {}) => app.request('/x', { headers }) };
}
const sesion = (rol: string, renewed = false) => ({ actor: { id: 'u1', rol }, renewed, expiresAt: EXPIRES });

describe('middleware de autorización', () => {
  it('sin cookie => 401 y no resuelve sesión', async () => {
    const { get, sessions } = setup(sesion('ADMIN'));
    const res = await get();
    expect(res.status).toBe(401);
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it('sesión inexistente/caducada => 401 y limpia la cookie', async () => {
    const { get } = setup(null);
    const res = await get({ cookie: 'sesion=tok' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^sesion=;/);
  });

  it('sesión válida sin restricción de rol => pasa con el Actor en el contexto', async () => {
    const { get, sessions } = setup(sesion('ALUMNO'));
    const res = await get({ cookie: 'sesion=tok' });
    expect(res.status).toBe(200);
    expect(sessions.resolve).toHaveBeenCalledWith('tok');
    expect(await res.json()).toEqual({ actor: { id: 'u1', rol: 'ALUMNO' } });
  });

  it('rol permitido => 200', async () => {
    const { get } = setup(sesion('ADMIN'), ['ADMIN']);
    expect((await get({ cookie: 'sesion=tok' })).status).toBe(200);
  });

  it('rol no permitido => 403', async () => {
    const { get } = setup(sesion('SOCIO'), ['ADMIN']);
    expect((await get({ cookie: 'sesion=tok' })).status).toBe(403);
  });

  it('varios roles permitidos', async () => {
    const a = setup(sesion('SOCIO'), ['ADMIN', 'SOCIO']);
    expect((await a.get({ cookie: 'sesion=tok' })).status).toBe(200);
    const b = setup(sesion('ALUMNO'), ['ADMIN', 'SOCIO']);
    expect((await b.get({ cookie: 'sesion=tok' })).status).toBe(403);
  });

  it('sesión renovada => repone la cookie', async () => {
    const { get } = setup(sesion('ALUMNO', true));
    const res = await get({ cookie: 'sesion=tok' });
    expect(res.headers.get('set-cookie')).toMatch(/^sesion=tok;.*Expires=/);
  });

  it('403 no limpia la cookie', async () => {
    const { get } = setup(sesion('SOCIO'), ['ADMIN']);
    const res = await get({ cookie: 'sesion=tok' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
