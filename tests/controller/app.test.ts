import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/controller/app';

const EXPIRES = new Date('2030-01-01T00:00:00Z');

/** App real compuesta con dobles en memoria: comprueba el cableado y el acceso por rol. */
function setup(rol: string | null) {
  const sessions = {
    resolve: vi.fn(async () => (rol ? ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES } as never) : null)),
    destroy: vi.fn(async () => undefined),
    create: vi.fn(),
  };
  const ok = (v: unknown = {}) => vi.fn(async () => v as never);
  const catalog = { catalog: ok([]), addToCatalog: ok() };
  const own = { listOwn: ok([]), set: ok(), remove: ok() };
  const app = createApp({
    sessions,
    users: { findById: ok({ id: 'u1' }), findByEmail: ok(null), createUser: ok({ id: 'n1' }) },
    verification: { verify: ok('u1') },
    editions: { list: ok([]), get: ok(), create: ok(), update: ok(), close: ok() },
    students: { create: ok() },
    companies: { list: ok([]), create: ok(), update: ok(), setSocia: ok() },
    profile: { getOwn: ok(), updateOwn: ok() },
    status: { setEstado: ok(), getForCompany: ok() },
    consent: { giveOwn: ok() },
    forgetter: { forget: ok() },
    projects: { list: ok([]), create: ok(), update: ok(), remove: ok() },
    skills: catalog,
    languages: catalog,
    studentSkills: own,
    studentLanguages: own,
    cookie: { production: false },
  } as never);
  return async (method: string, path: string, body?: unknown) =>
    (
      await app.request(path, {
        method,
        headers: { 'content-type': 'application/json', cookie: 'sesion=tok' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    ).status;
}

describe('createApp: composición de todas las rutas bajo /api', () => {
  it('sin sesión: 401 en rutas protegidas', async () => {
    const req = setup(null);
    expect(await req('GET', '/api/me')).toBe(401);
    expect(await req('GET', '/api/editions')).toBe(401);
    expect(await req('GET', '/api/students/me')).toBe(401);
  });
  it('ALUMNO: ficha, estado, consentimiento, proyectos, skills, idiomas y catálogo', async () => {
    const req = setup('ALUMNO');
    expect(await req('GET', '/api/me')).toBe(200);
    expect(await req('GET', '/api/students/me')).toBe(200);
    expect(await req('PUT', '/api/students/me/estado', { estado: 'activo' })).toBe(200);
    expect(await req('GET', '/api/students/me/projects')).toBe(200);
    expect(await req('GET', '/api/students/me/skills')).toBe(200);
    expect(await req('GET', '/api/students/me/languages')).toBe(200);
    expect(await req('GET', '/api/catalog/skills')).toBe(200);
  });
  it('ALUMNO no accede a administración ni a otros alumnos', async () => {
    const req = setup('ALUMNO');
    expect(await req('GET', '/api/editions')).toBe(403);
    expect(await req('POST', '/api/companies', {})).toBe(403);
    expect(await req('POST', '/api/students', {})).toBe(403);
    expect(await req('GET', '/api/students/abc')).toBe(403);
    expect(await req('POST', '/api/auth/register', {})).toBe(403);
  });
  it('SOCIO consulta alumnos y nada más', async () => {
    const req = setup('SOCIO');
    expect(await req('GET', '/api/students/abc')).toBe(200);
    expect(await req('GET', '/api/students/me')).toBe(403);
    expect(await req('GET', '/api/editions')).toBe(403);
  });
  it('ADMIN gestiona ediciones, empresas y registro', async () => {
    const req = setup('ADMIN');
    expect(await req('GET', '/api/editions')).toBe(200);
    expect(await req('POST', '/api/companies', {})).toBe(400);
    expect(await req('POST', '/api/auth/register', {})).toBe(400);
  });
  it('rutas públicas de auth montadas y errores globales con manejador', async () => {
    const req = setup(null);
    expect(await req('POST', '/api/auth/login', {})).toBe(400);
    expect(await req('POST', '/api/auth/verify-email', {})).toBe(400);
    expect(await req('POST', '/api/auth/logout')).toBe(204);
    expect(await req('GET', '/api/no-existe')).toBe(404);
  });
});
