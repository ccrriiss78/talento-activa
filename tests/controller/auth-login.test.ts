import { describe, it, expect, vi } from 'vitest';
import { createAuthRoutes } from '../../src/controller/auth';
import { hashPassword } from '../../src/model/password';

const PASSWORD = 'una-contraseña-larga-1';
const EXPIRES = new Date('2030-01-01T00:00:00Z');
const USER = { id: 'u1', email: 'a@b.es', rol: 'ALUMNO' as const, email_verified: true, created_at: new Date() };

async function setup() {
  const user = { ...USER, password_hash: await hashPassword(PASSWORD) };
  const users = { findByEmail: vi.fn(async (e: string) => (e.toLowerCase() === USER.email ? user : null)) };
  const sessions = {
    create: vi.fn(async () => ({ token: 'tok_nuevo-123', expiresAt: EXPIRES })),
    destroy: vi.fn(async () => {}),
  };
  const app = createAuthRoutes({ users, sessions, cookie: { production: false } });
  const login = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { login, users, sessions };
}

describe('POST /login', () => {
  it('credenciales correctas => 200, cookie de sesión y token solo en la cookie', async () => {
    const { login, sessions } = await setup();
    const res = await login({ email: USER.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(sessions.create).toHaveBeenCalledWith('u1');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sesion=tok_nuevo-123;/);
    expect(cookie).toMatch(/HttpOnly/);
    const texto = await res.text();
    expect(texto).not.toContain('tok_nuevo-123');
    expect(texto).not.toContain('password_hash');
    expect(JSON.parse(texto)).toMatchObject({ id: 'u1', email: USER.email, rol: 'ALUMNO' });
  });

  it('el email se busca sin distinguir mayúsculas', async () => {
    const { login } = await setup();
    expect((await login({ email: 'A@B.ES', password: PASSWORD })).status).toBe(200);
  });

  it('invalida la sesión previa que trajera la cookie', async () => {
    const { login, sessions } = await setup();
    await login({ email: USER.email, password: PASSWORD }, { cookie: 'sesion=tok_viejo' });
    expect(sessions.destroy).toHaveBeenCalledWith('tok_viejo');
  });

  it('anti-enumeración: mismo estado y mismo cuerpo con email inexistente o contraseña errónea', async () => {
    const { login, sessions } = await setup();
    const a = await login({ email: 'nadie@x.es', password: PASSWORD });
    const b = await login({ email: USER.email, password: 'otra-contraseña-larga' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
    expect(a.headers.get('set-cookie')).toBeNull();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('mismo coste temporal: con email inexistente también se verifica contra el señuelo', async () => {
    const { login } = await setup();
    await login({ email: USER.email, password: 'x'.repeat(14) }); // calienta
    const t = async (email: string) => {
      const ini = performance.now();
      await login({ email, password: 'x'.repeat(14) });
      return performance.now() - ini;
    };
    const existente = await t(USER.email);
    const inexistente = await t('nadie@x.es');
    expect(inexistente).toBeGreaterThan(existente * 0.5);
    expect(inexistente).toBeGreaterThan(5); // no es un cortocircuito instantáneo
  });

  it('cuerpo mal formado => 400', async () => {
    const { login } = await setup();
    expect((await login({ email: 5 })).status).toBe(400);
    expect((await login({})).status).toBe(400);
  });
});
