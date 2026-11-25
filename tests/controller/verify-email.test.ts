import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createVerifyEmailRoutes } from '../../src/controller/verify-email';
import { createAuthRoutes } from '../../src/controller/auth';
import { TokenVerificacionNoValidoError } from '../../src/model/email-verification';
import { hashPassword } from '../../src/model/password';

describe('POST /api/auth/verify-email', () => {
  const setup = (verify: (t: string) => Promise<string>) => {
    const verification = { verify: vi.fn(verify) };
    const app = new Hono();
    app.route('/api/auth', createVerifyEmailRoutes({ verification }));
    const post = (body: unknown) =>
      app.request('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    return { verification, post };
  };

  it('token válido => 204 sin cuerpo ni cookie', async () => {
    const { post, verification } = setup(async () => 'u1');
    const res = await post({ token: 'abc' });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(verification.verify).toHaveBeenCalledWith('abc');
  });

  it('token no válido/usado/caducado => 400 con mensaje genérico', async () => {
    const { post } = setup(async () => {
      throw new TokenVerificacionNoValidoError();
    });
    const res = await post({ token: 'abc' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enlace de verificación no válido o caducado' });
  });

  it('body sin token string => 400 y no consulta el modelo', async () => {
    const { post, verification } = setup(async () => 'u1');
    expect((await post({})).status).toBe(400);
    expect((await post({ token: 5 })).status).toBe(400);
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('error inesperado se propaga (no se traga como 400)', async () => {
    const { post } = setup(async () => {
      throw new Error('boom');
    });
    expect((await post({ token: 'abc' })).status).toBe(500);
  });
});

describe('login con email sin verificar', () => {
  const PASS = 'una-clave-larga-123';
  async function setup(verified: boolean) {
    const user = { id: 'u1', email: 'a@b.es', rol: 'ALUMNO' as const, email_verified: verified, created_at: new Date(), password_hash: await hashPassword(PASS) };
    const sessions = { create: vi.fn(async () => ({ token: 't', expiresAt: new Date('2030-01-01') })), destroy: vi.fn(async () => {}) };
    const app = new Hono();
    app.route('/api/auth', createAuthRoutes({ users: { findByEmail: async () => user }, sessions, cookie: { production: false } }));
    const post = (password: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.es', password }),
      });
    return { sessions, post };
  }

  it('contraseña correcta pero sin verificar => 403, sin sesión ni cookie', async () => {
    const { post, sessions } = await setup(false);
    const res = await post(PASS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cuenta pendiente de verificación de email' });
    expect(sessions.create).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('contraseña incorrecta y sin verificar => mismo 401 genérico (no revela el estado)', async () => {
    const { post } = await setup(false);
    const res = await post('otra-clave-larga-999');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Credenciales no válidas' });
  });

  it('verificado => 200 y sesión creada', async () => {
    const { post, sessions } = await setup(true);
    expect((await post(PASS)).status).toBe(200);
    expect(sessions.create).toHaveBeenCalled();
  });
});
