import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentRoutes } from '../../src/controller/students';
import { manejarErrores } from '../../src/controller/errores';

const sesion = { actor: { id: 'admin1', rol: 'ADMIN' }, renewed: false, expiresAt: new Date('2030-01-01T00:00:00Z') };
const BODY = { email: 'a@x.es', password: 'una-clave-larga-123', edition_id: 'no-es-uuid', nombre: 'Ana' };

function post(create: () => Promise<never>) {
  const sessions = { resolve: vi.fn(async () => sesion as never) };
  const app = new Hono();
  app.onError(manejarErrores);
  app.route('/api/students', createStudentRoutes({ sessions, students: { create } as never, cookie: { production: false } }));
  return app.request('/api/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'sesion=tok' },
    body: JSON.stringify(BODY),
  });
}

describe('POST /api/students: uuid mal formado en el body (hallazgo 4 revisión 2026-11-26)', () => {
  it('edition_id no uuid (22P02 de Postgres) => 400 Datos no válidos, no 404', async () => {
    const r = await post(async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Datos no válidos' });
  });
});
