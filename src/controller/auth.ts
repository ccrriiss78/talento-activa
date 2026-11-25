import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { toPublic, type UserConHash } from '../model/user';
import { hashPassword, verifyPassword } from '../model/password';
import { SESSION_COOKIE_NAME, buildSessionCookie, type CookieOptions } from './cookie';

export interface AuthDeps {
  users: { findByEmail(email: string): Promise<UserConHash | null> };
  sessions: {
    create(userId: string): Promise<{ token: string; expiresAt: Date }>;
    destroy(token: string): Promise<void>;
  };
  cookie?: CookieOptions;
}

const ERROR_CREDENCIALES = { error: 'Credenciales no válidas' };

export function createAuthRoutes(deps: AuthDeps) {
  const app = new Hono();
  // Hash señuelo generado en arranque (sin hashes incrustados): iguala el coste cuando el email no existe.
  const HASH_SEÑUELO = hashPassword(`señuelo-${crypto.randomUUID()}-${crypto.randomUUID()}`);

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
      return c.json({ error: 'Datos no válidos' }, 400);
    }
    const user = await deps.users.findByEmail(body.email);
    const ok = await verifyPassword(body.password, user ? user.password_hash : await HASH_SEÑUELO);
    if (!user || !ok) return c.json(ERROR_CREDENCIALES, 401);

    const previa = getCookie(c, SESSION_COOKIE_NAME);
    if (previa) await deps.sessions.destroy(previa);
    const { token, expiresAt } = await deps.sessions.create(user.id);
    c.header('Set-Cookie', buildSessionCookie(token, expiresAt, deps.cookie));
    return c.json(toPublic(user));
  });

  return app;
}
