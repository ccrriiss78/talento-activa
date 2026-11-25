import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentRoutes } from '../../src/controller/students';
import { EdicionNoEncontradaError } from '../../src/model/edition';
import { EmailYaRegistradoError } from '../../src/model/user';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'admin1', rol }, renewed: false, expiresAt: EXPIRES });
const STUDENT = { id: 's1', user_id: 'u1', edition_id: 'e1', nombre: 'Ana', estado: 'inactivo' };
const BODY = { email: 'a@x.es', password: 'una-clave-larga-123', edition_id: 'e1', nombre: 'Ana' };

function setup(rol: string | null, create = vi.fn(async () => STUDENT)) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const app = new Hono();
  app.route('/api/students', createStudentRoutes({ sessions, students: { create } as never, cookie: { production: false } }));
  const post = (body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request('/api/students', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { post, create };
}

describe('POST /api/students (solo ADMIN)', () => {
  it('sin sesión 401; SOCIO y ALUMNO 403 sin llamar al modelo', async () => {
    expect((await setup(null).post(BODY, {})).status).toBe(401);
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const { post, create } = setup(rol);
      expect((await post(BODY)).status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('crea => 201 con Actor y solo los campos conocidos', async () => {
    const { post, create } = setup('ADMIN');
    const r = await post({ ...BODY, estado: 'activo', rol: 'ADMIN', user_id: 'x' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual(STUDENT);
    expect(create).toHaveBeenCalledWith({ id: 'admin1', rol: 'ADMIN' }, BODY);
  });

  it.each([undefined, 'texto', [1], { ...BODY, email: 5 }, { ...BODY, password: undefined }])(
    'cuerpo inválido %j => 400',
    async (b) => {
      const { post, create } = setup('ADMIN');
      expect((await post(b as never)).status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('mapea errores del modelo: datos 400, edición 404, email repetido 409 genérico', async () => {
    const casos: [Error, number][] = [
      [new DatosNoValidosError(), 400],
      [new EdicionNoEncontradaError(), 404],
      [new EmailYaRegistradoError(), 409],
    ];
    for (const [err, status] of casos) {
      const { post } = setup('ADMIN', vi.fn(async () => { throw err; }));
      const r = await post(BODY);
      expect(r.status).toBe(status);
      if (status === 409) expect(await r.json()).toEqual({ error: 'No se ha podido completar el registro' });
    }
  });
});
