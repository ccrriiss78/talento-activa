import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createCompanyRoutes } from '../../src/controller/companies';
import { EmpresaNoEncontradaError } from '../../src/model/company';
import { EmailYaRegistradoError } from '../../src/model/user';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'admin1', rol }, renewed: false, expiresAt: EXPIRES });
const COMPANY = { id: 'c1', nombre: 'Acme', es_socia: true, contacto: null, created_by: 'admin1' };
const BODY = { email: 'e@x.es', password: 'una-clave-larga-123', nombre: 'Acme', es_socia: true, contacto: 'rrhh@acme.es' };

function setup(rol: string | null, over: { create?: unknown; setSocia?: unknown } = {}) {
  const create = (over.create ?? vi.fn(async () => COMPANY)) as ReturnType<typeof vi.fn>;
  const setSocia = (over.setSocia ?? vi.fn(async () => COMPANY)) as ReturnType<typeof vi.fn>;
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const app = new Hono();
  app.route('/api/companies', createCompanyRoutes({ sessions, companies: { create, setSocia } as never, cookie: { production: false } }));
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/companies${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { req, create, setSocia };
}

describe('POST /api/companies (solo ADMIN)', () => {
  it('sin sesión 401; SOCIO y ALUMNO 403 sin llamar al modelo', async () => {
    expect((await setup(null).req('POST', '', BODY, {})).status).toBe(401);
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const { req, create } = setup(rol);
      expect((await req('POST', '', BODY)).status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('crea => 201 con Actor y solo campos conocidos', async () => {
    const { req, create } = setup('ADMIN');
    const r = await req('POST', '', { ...BODY, rol: 'ADMIN', created_by: 'x' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual(COMPANY);
    expect(create).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, BODY);
  });

  it.each([undefined, 'texto', [1], { ...BODY, email: 5 }, { ...BODY, nombre: undefined }])(
    'cuerpo inválido %j => 400',
    async (b) => {
      const { req, create } = setup('ADMIN');
      expect((await req('POST', '', b as never)).status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('mapea errores: datos 400, email repetido 409 genérico', async () => {
    const casos: [Error, number][] = [
      [new DatosNoValidosError(), 400],
      [new EmailYaRegistradoError(), 409],
    ];
    for (const [err, status] of casos) {
      const { req } = setup('ADMIN', { create: vi.fn(async () => { throw err; }) });
      const r = await req('POST', '', BODY);
      expect(r.status).toBe(status);
      if (status === 409) expect(await r.json()).toEqual({ error: 'No se ha podido completar el registro' });
    }
  });
});

describe('PATCH /api/companies/:id/socia (solo ADMIN)', () => {
  it('SOCIO 403', async () => {
    const { req, setSocia } = setup('SOCIO');
    expect((await req('PATCH', '/c1/socia', { es_socia: true })).status).toBe(403);
    expect(setSocia).not.toHaveBeenCalled();
  });

  it('actualiza => 200', async () => {
    const { req, setSocia } = setup('ADMIN');
    const r = await req('PATCH', '/c1/socia', { es_socia: true });
    expect(r.status).toBe(200);
    expect(setSocia).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, 'c1', true);
  });

  it('cuerpo sin booleano => 400; empresa inexistente => 404', async () => {
    const { req } = setup('ADMIN');
    expect((await req('PATCH', '/c1/socia', { es_socia: 'si' })).status).toBe(400);
    const nf = setup('ADMIN', { setSocia: vi.fn(async () => { throw new EmpresaNoEncontradaError(); }) });
    expect((await nf.req('PATCH', '/c1/socia', { es_socia: true })).status).toBe(404);
  });
});
