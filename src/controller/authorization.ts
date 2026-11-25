import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Actor, Rol } from '../model/actor';
import type { SessionResolved } from '../model/session';
import { SESSION_COOKIE_NAME, buildSessionCookie, clearSessionCookie, type CookieOptions } from './cookie';

export interface AuthMiddlewareDeps {
  sessions: { resolve(token: string): Promise<SessionResolved | null> };
  cookie?: CookieOptions;
}

const ACTOR_KEY = 'actor';

/** Actor autenticado por el middleware (solo válido tras `createAuthMiddleware`). */
export function getActor(c: Context): Actor {
  return c.get(ACTOR_KEY) as Actor;
}

/** Resuelve la sesión de la cookie y, si se indican `roles`, exige uno de ellos (401 / 403). */
export function createAuthMiddleware(deps: AuthMiddlewareDeps, roles?: Rol[]): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) return c.json({ error: 'No autenticado' }, 401);
    const session = await deps.sessions.resolve(token);
    if (!session) {
      c.header('Set-Cookie', clearSessionCookie(deps.cookie));
      return c.json({ error: 'No autenticado' }, 401);
    }
    if (session.renewed) c.header('Set-Cookie', buildSessionCookie(token, session.expiresAt, deps.cookie));
    if (roles && !roles.includes(session.actor.rol)) return c.json({ error: 'Prohibido' }, 403);
    c.set(ACTOR_KEY, session.actor);
    await next();
  };
}
