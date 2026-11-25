import { Hono } from 'hono';
import { TokenVerificacionNoValidoError } from '../model/email-verification';

export interface VerifyEmailDeps {
  verification: { verify(token: string): Promise<string> };
}

/** POST /verify-email (montar bajo /api/auth): consume el token de un solo uso del enlace del email. */
export function createVerifyEmailRoutes(deps: VerifyEmailDeps) {
  const app = new Hono();
  app.post('/verify-email', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.token !== 'string') return c.json({ error: 'Datos no válidos' }, 400);
    try {
      await deps.verification.verify(body.token);
      return c.body(null, 204);
    } catch (e) {
      if (e instanceof TokenVerificacionNoValidoError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  return app;
}
