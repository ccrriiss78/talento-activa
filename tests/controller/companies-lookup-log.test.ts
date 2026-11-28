import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createCompanyRoutes } from '../../src/controller/companies';

afterEach(() => vi.restoreAllMocks());

const sesion = { actor: { id: 'admin1', rol: 'ADMIN' }, renewed: false, expiresAt: new Date('2030-01-01T00:00:00Z') };
const EMPRESA = { id: 'c1', nombre: 'ACME', es_socia: false, contacto: null, created_by: 'admin1' };

describe('POST /api/companies: fallo al localizar el usuario SOCIO (hallazgo 3 revisión 2026-11-27)', () => {
  it('el alta sigue en 201, no se envía el email y queda un log genérico sin el email', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sendTo = vi.fn(async () => {});
    const app = new Hono();
    app.route(
      '/api/companies',
      createCompanyRoutes({
        sessions: { resolve: vi.fn(async () => sesion as never) },
        cookie: { production: false },
        companies: { create: vi.fn(async () => EMPRESA), setSocia: vi.fn() } as never,
        users: { findByEmail: vi.fn(async () => { throw new Error('db caída a@x.es'); }) },
        verificationSender: { sendTo },
      }),
    );
    const r = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'sesion=tok' },
      body: JSON.stringify({ email: 'a@x.es', password: 'una-clave-larga-123', nombre: 'ACME' }),
    });
    expect(r.status).toBe(201);
    expect(sendTo).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const texto = JSON.stringify(warn.mock.calls);
    expect(texto).not.toContain('a@x.es');
    expect(texto).not.toContain('db caída');
  });
});
