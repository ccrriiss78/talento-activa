import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createProjectRoutes } from '../../src/controller/projects';
import { ProyectoNoEncontradoError } from '../../src/model/project';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });
const P = { id: 'p1', titulo: 'App' };
const ACTOR = { id: 'u1', rol: 'ALUMNO' };

function setup(rol: string | null, over: Record<string, unknown> = {}) {
  const sessions = { resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) };
  const projects = {
    list: vi.fn(async () => [P]),
    create: vi.fn(async () => P),
    update: vi.fn(async () => P),
    remove: vi.fn(async () => {}),
    ...over,
  };
  const app = new Hono();
  app.route('/api/students/me/projects', createProjectRoutes({ sessions, projects: projects as never, cookie: { production: false } }));
  const req = (method: string, path = '', body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/students/me/projects${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { req, projects };
}

describe('/api/students/me/projects (solo ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403 sin llamar al modelo', async () => {
    expect((await setup(null).req('GET', '', undefined, {})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, projects } = setup(rol);
      expect((await req('GET')).status).toBe(403);
      expect((await req('POST', '', { titulo: 'x' })).status).toBe(403);
      expect((await req('PUT', '/p1', { titulo: 'x' })).status).toBe(403);
      expect((await req('DELETE', '/p1')).status).toBe(403);
      for (const f of Object.values(projects)) expect(f).not.toHaveBeenCalled();
    }
  });

  it('GET lista', async () => {
    const { req, projects } = setup('ALUMNO');
    const r = await req('GET');
    expect(await r.json()).toEqual([P]);
    expect(projects.list).toHaveBeenCalledWith(ACTOR);
  });

  it('POST crea y devuelve 201', async () => {
    const { req, projects } = setup('ALUMNO');
    const r = await req('POST', '', { titulo: 'App', url: 'https://a.b' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual(P);
    expect(projects.create).toHaveBeenCalledWith(ACTOR, { titulo: 'App', url: 'https://a.b' });
  });

  it('PUT actualiza por id', async () => {
    const { req, projects } = setup('ALUMNO');
    const r = await req('PUT', '/p1', { titulo: 'N' });
    expect(r.status).toBe(200);
    expect(projects.update).toHaveBeenCalledWith(ACTOR, 'p1', { titulo: 'N' });
  });

  it('DELETE responde 204', async () => {
    const { req, projects } = setup('ALUMNO');
    expect((await req('DELETE', '/p1')).status).toBe(204);
    expect(projects.remove).toHaveBeenCalledWith(ACTOR, 'p1');
  });

  it.each([undefined, 'texto', [1], null])('POST/PUT con cuerpo %j => 400', async (b) => {
    const { req, projects } = setup('ALUMNO');
    expect((await req('POST', '', b as never)).status).toBe(400);
    expect((await req('PUT', '/p1', b as never)).status).toBe(400);
    expect(projects.create).not.toHaveBeenCalled();
    expect(projects.update).not.toHaveBeenCalled();
  });

  it('mapea errores: 400 datos, 404 proyecto/ficha', async () => {
    const bad = setup('ALUMNO', { create: vi.fn(async () => { throw new DatosNoValidosError(); }) });
    expect((await bad.req('POST', '', { a: 1 })).status).toBe(400);
    const nf = setup('ALUMNO', { remove: vi.fn(async () => { throw new ProyectoNoEncontradoError(); }) });
    expect((await nf.req('DELETE', '/p9')).status).toBe(404);
    const nf2 = setup('ALUMNO', { list: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await nf2.req('GET')).status).toBe(404);
  });
});
