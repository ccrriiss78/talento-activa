import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createCatalogRoutes, createTaxonomyRoutes } from '../../src/controller/taxonomy';
import { ElementoNoEncontradoError } from '../../src/model/taxonomy';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';

const EXPIRES = new Date('2030-01-01T00:00:00Z');
const sesion = (rol: string) => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES });
const ITEM = { id: 'k1', nombre: 'TS' };
const ACTOR = { id: 'u1', rol: 'ALUMNO' };
const modelo = (over: Record<string, unknown> = {}) => ({
  catalog: vi.fn(async () => [ITEM]),
  addToCatalog: vi.fn(async () => ITEM),
  listOwn: vi.fn(async () => [{ ...ITEM, nivel: 'medio' }]),
  set: vi.fn(async () => ({ ...ITEM, nivel: 'medio' })),
  remove: vi.fn(async () => {}),
  ...over,
});
const sessionsFor = (rol: string | null) => ({ resolve: vi.fn(async () => (rol ? sesion(rol) : null) as never) });

function setupOwn(rol: string | null, over: Record<string, unknown> = {}) {
  const skills = modelo(over);
  const languages = modelo();
  const app = new Hono();
  app.route('/api/students/me/skills', createTaxonomyRoutes({ sessions: sessionsFor(rol), model: skills as never, cookie: { production: false } }));
  app.route('/api/students/me/languages', createTaxonomyRoutes({ sessions: sessionsFor(rol), model: languages as never, cookie: { production: false } }));
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, skills, languages };
}

function setupCatalog(rol: string | null) {
  const skills = modelo();
  const languages = modelo();
  const app = new Hono();
  app.route('/api/catalog', createCatalogRoutes({ sessions: sessionsFor(rol), skills: skills as never, languages: languages as never, cookie: { production: false } }));
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie: 'sesion=tok' }) =>
    app.request(`/api/catalog${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, skills, languages };
}

describe('/api/students/me/{skills,languages} (solo ALUMNO)', () => {
  it('sin sesión 401; ADMIN y SOCIO 403 sin llamar al modelo', async () => {
    expect((await setupOwn(null).req('GET', '/api/students/me/skills', undefined, {})).status).toBe(401);
    for (const rol of ['ADMIN', 'SOCIO']) {
      const { req, skills } = setupOwn(rol);
      expect((await req('GET', '/api/students/me/skills')).status).toBe(403);
      expect((await req('PUT', '/api/students/me/skills/k1', { nivel: 'medio' })).status).toBe(403);
      expect((await req('DELETE', '/api/students/me/skills/k1')).status).toBe(403);
      for (const f of Object.values(skills)) expect(f).not.toHaveBeenCalled();
    }
  });
  it('GET lista los propios', async () => {
    const { req, skills } = setupOwn('ALUMNO');
    const r = await req('GET', '/api/students/me/skills');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ ...ITEM, nivel: 'medio' }]);
    expect(skills.listOwn).toHaveBeenCalledWith(ACTOR);
  });
  it('PUT /:id asocia con nivel (cada ruta usa su modelo)', async () => {
    const { req, skills, languages } = setupOwn('ALUMNO');
    const r = await req('PUT', '/api/students/me/skills/k1', { nivel: 'medio' });
    expect(r.status).toBe(200);
    expect(skills.set).toHaveBeenCalledWith(ACTOR, 'k1', 'medio');
    await req('PUT', '/api/students/me/languages/k2', { nivel: 'B2' });
    expect(languages.set).toHaveBeenCalledWith(ACTOR, 'k2', 'B2');
  });
  it('PUT sin nivel => nivel null; cuerpo no JSON => 400', async () => {
    const { req, skills } = setupOwn('ALUMNO');
    await req('PUT', '/api/students/me/skills/k1', {});
    expect(skills.set).toHaveBeenCalledWith(ACTOR, 'k1', null);
    const r = await req('PUT', '/api/students/me/skills/k1', [1]);
    expect(r.status).toBe(400);
  });
  it('DELETE /:id => 204', async () => {
    const { req, skills } = setupOwn('ALUMNO');
    expect((await req('DELETE', '/api/students/me/skills/k1')).status).toBe(204);
    expect(skills.remove).toHaveBeenCalledWith(ACTOR, 'k1');
  });
  it('errores del modelo: 400 / 404', async () => {
    let s = setupOwn('ALUMNO', { set: vi.fn(async () => { throw new DatosNoValidosError(); }) });
    expect((await s.req('PUT', '/api/students/me/skills/k1', { nivel: 'x' })).status).toBe(400);
    s = setupOwn('ALUMNO', { set: vi.fn(async () => { throw new ElementoNoEncontradoError(); }) });
    expect((await s.req('PUT', '/api/students/me/skills/k1', {})).status).toBe(404);
    s = setupOwn('ALUMNO', { remove: vi.fn(async () => { throw new ElementoNoEncontradoError(); }) });
    expect((await s.req('DELETE', '/api/students/me/skills/k1')).status).toBe(404);
    s = setupOwn('ALUMNO', { listOwn: vi.fn(async () => { throw new FichaNoEncontradaError(); }) });
    expect((await s.req('GET', '/api/students/me/skills')).status).toBe(404);
  });
});

describe('/api/catalog', () => {
  it('sin sesión 401', async () => {
    expect((await setupCatalog(null).req('GET', '/skills', undefined, {})).status).toBe(401);
  });
  it('GET skills/languages para cualquier rol autenticado', async () => {
    for (const rol of ['ADMIN', 'SOCIO', 'ALUMNO']) {
      const { req, skills, languages } = setupCatalog(rol);
      expect(await (await req('GET', '/skills')).json()).toEqual([ITEM]);
      expect(await (await req('GET', '/languages')).json()).toEqual([ITEM]);
      expect(skills.catalog).toHaveBeenCalled();
      expect(languages.catalog).toHaveBeenCalled();
    }
  });
  it('POST solo ADMIN: crea (201); otros roles 403', async () => {
    const { req, skills, languages } = setupCatalog('ADMIN');
    const r = await req('POST', '/skills', { nombre: 'Rust' });
    expect(r.status).toBe(201);
    expect(skills.addToCatalog).toHaveBeenCalledWith({ id: 'u1', rol: 'ADMIN' }, 'Rust');
    await req('POST', '/languages', { nombre: 'Gallego' });
    expect(languages.addToCatalog).toHaveBeenCalled();
    for (const rol of ['SOCIO', 'ALUMNO']) {
      const s = setupCatalog(rol);
      expect((await s.req('POST', '/skills', { nombre: 'x' })).status).toBe(403);
      expect(s.skills.addToCatalog).not.toHaveBeenCalled();
    }
  });
  it('POST con datos no válidos => 400', async () => {
    const { req, skills } = setupCatalog('ADMIN');
    expect((await req('POST', '/skills', [1])).status).toBe(400);
    skills.addToCatalog.mockRejectedValueOnce(new DatosNoValidosError());
    expect((await req('POST', '/skills', { nombre: '' })).status).toBe(400);
  });
});
