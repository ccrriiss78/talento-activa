import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createRegisterRoutes } from '../../src/controller/register';
import { EmailYaRegistradoError } from '../../src/model/user';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'admin1', rol }, renewed: false, expiresAt: EXPIRES });
const CREADO = { id: 'u2', email: 'a@b.es', rol: 'ALUMNO', email_verified: false, created_at: new Date('2026-01-01') };

function setup(rol: string | null, createUser: (...a: unknown[]) => Promise<unknown> = async () => CREADO) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const users = { createUser: vi.fn(createUser as never) };
  const app = new Hono();
  app.route('/api/auth', createRegisterRoutes({ sessions, users: users as never, cookie: { production: false } }));
  const post = (body: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { users, post };
}
const valido = { email: 'a@b.es', password: 'una-clave-larga-123', rol: 'ALUMNO' };

describe('POST /api/auth/register (solo ADMIN)', () => {
  it('sin sesión => 401 y no crea', async () => {
    const { post, users } = setup(null);
    expect((await post(valido, {})).status).toBe(401);
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it.each(['SOCIO', 'ALUMNO'])('rol %s => 403 y no crea', async (rol) => {
    const { post, users } = setup(rol);
    expect((await post(valido)).status).toBe(403);
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it('ADMIN => 201 con proyección pública y llama al modelo con su Actor', async () => {
    const { post, users } = setup('ADMIN');
    const res = await post(valido);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.email).toBe('a@b.es');
    expect(json).not.toHaveProperty('password_hash');
    expect(users.createUser).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, valido);
  });

  it('body no válido => 400', async () => {
    const { post, users } = setup('ADMIN');
    expect((await post({ email: 'a@b.es' })).status).toBe(400);
    expect((await post({ ...valido, rol: 5 })).status).toBe(400);
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it('datos no válidos del modelo (clave corta/rol) => 400', async () => {
    const { post } = setup('ADMIN', async () => {
      throw new DatosNoValidosError();
    });
    expect((await post(valido)).status).toBe(400);
  });

  it('email ya registrado => 409 genérico', async () => {
    const { post } = setup('ADMIN', async () => {
      throw new EmailYaRegistradoError();
    });
    const res = await post(valido);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'No se ha podido completar el registro' });
  });

  it('error inesperado se propaga (no se traga)', async () => {
    const { post } = setup('ADMIN', async () => {
      throw new Error('boom');
    });
    expect((await post(valido)).status).toBe(500);
  });
});
