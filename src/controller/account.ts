import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { toPublic, type UserPublic } from '../model/user';
import type { SessionResolved } from '../model/session';
import { SESSION_COOKIE_NAME, buildSessionCookie, clearSessionCookie, type CookieOptions } from './cookie';

export interface LogoutDeps {
  sessions: { destroy(token: string): Promise<void> };
  cookie?: CookieOptions;
}

export interface MeDeps {
  sessions: { resolve(token: string): Promise<SessionResolved | null> };
  users: { findById(id: string): Promise<UserPublic | null> };
  cookie?: CookieOptions;
}

/** POST /logout (montar bajo /api/auth): borra la sesión y limpia la cookie; idempotente. */
export function createLogoutRoutes(deps: LogoutDeps) {
  const app = new Hono();
  app.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token) await deps.sessions.destroy(token);
    c.header('Set-Cookie', clearSessionCookie(deps.cookie));
    return c.body(null, 204);
  });
  return app;
}

/** GET /me (montar bajo /api): usuario actual, proyección pública sin hash. */
export function createMeRoutes(deps: MeDeps) {
  const app = new Hono();
  app.get('/me', async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) return c.json({ error: 'No autenticado' }, 401);
    const session = await deps.sessions.resolve(token);
    const user = session ? await deps.users.findById(session.actor.id) : null;
    if (!session || !user) {
      c.header('Set-Cookie', clearSessionCookie(deps.cookie));
      return c.json({ error: 'No autenticado' }, 401);
    }
    if (session.renewed) c.header('Set-Cookie', buildSessionCookie(token, session.expiresAt, deps.cookie));
    return c.json(toPublic(user));
  });
  return app;
}
