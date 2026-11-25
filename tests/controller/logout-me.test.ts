import { describe, it, expect, vi } from 'vitest';
import { createLogoutRoutes, createMeRoutes } from '../../src/controller/account';

const USER = { id: 'u1', email: 'a@b.es', rol: 'ALUMNO' as const, email_verified: true, created_at: new Date(0) };
const EXPIRES = new Date('2030-01-01T00:00:00Z');

describe('POST /logout', () => {
  const setup = () => {
    const sessions = { destroy: vi.fn(async () => {}) };
    const app = createLogoutRoutes({ sessions, cookie: { production: false } });
    return { sessions, post: (headers: Record<string, string> = {}) => app.request('/logout', { method: 'POST', headers }) };
  };

  it('con cookie: borra la sesión y limpia la cookie', async () => {
    const { sessions, post } = setup();
    const res = await post({ cookie: 'sesion=tok_abc' });
    expect(res.status).toBe(204);
    expect(sessions.destroy).toHaveBeenCalledWith('tok_abc');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sesion=;/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it('idempotente: sin cookie también responde 204 y limpia la cookie', async () => {
    const { sessions, post } = setup();
    const res = await post();
    expect(res.status).toBe(204);
    expect(sessions.destroy).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toMatch(/^sesion=;/);
  });
});

describe('GET /me', () => {
  const setup = (resolved: unknown, user: unknown = USER) => {
    const sessions = { resolve: vi.fn(async () => resolved as never) };
    const users = { findById: vi.fn(async () => user as never) };
    const app = createMeRoutes({ sessions, users, cookie: { production: false } });
    return { sessions, users, get: (headers: Record<string, string> = {}) => app.request('/me', { headers }) };
  };
  const ACTOR = { actor: { id: 'u1', rol: 'ALUMNO' }, renewed: false, expiresAt: EXPIRES };

  it('sesión válida => 200 con proyección pública sin hash', async () => {
    const { get, sessions, users } = setup(ACTOR, { ...USER, password_hash: 'secreto' });
    const res = await get({ cookie: 'sesion=tok_abc' });
    expect(res.status).toBe(200);
    expect(sessions.resolve).toHaveBeenCalledWith('tok_abc');
    expect(users.findById).toHaveBeenCalledWith('u1');
    const texto = await res.text();
    expect(texto).not.toContain('password_hash');
    expect(texto).not.toContain('secreto');
    expect(JSON.parse(texto)).toMatchObject({ id: 'u1', email: 'a@b.es', rol: 'ALUMNO' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sin cookie => 401', async () => {
    const { get, sessions } = setup(ACTOR);
    expect((await get()).status).toBe(401);
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it('sesión inexistente o caducada => 401 y cookie limpiada', async () => {
    const { get } = setup(null);
    const res = await get({ cookie: 'sesion=tok_malo' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^sesion=;/);
  });

  it('renovación deslizante => repone la cookie con la nueva caducidad', async () => {
    const { get } = setup({ ...ACTOR, renewed: true });
    const res = await get({ cookie: 'sesion=tok_abc' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sesion=tok_abc;/);
    expect(cookie).toContain(EXPIRES.toUTCString());
  });

  it('usuario ya inexistente => 401', async () => {
    const { get } = setup(ACTOR, null);
    expect((await get({ cookie: 'sesion=tok_abc' })).status).toBe(401);
  });
});
