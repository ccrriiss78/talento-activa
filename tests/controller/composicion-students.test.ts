import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createStudentRoutes } from '../../src/controller/students';
import { createStudentSelfRoutes } from '../../src/controller/student-self';
import { createStudentStatusRoutes } from '../../src/controller/student-status';
import { createStudentForgetRoutes } from '../../src/controller/student-forget';
import { createProjectRoutes } from '../../src/controller/projects';

const EXPIRES = new Date('2030-01-01T00:00:00Z');

/** Monta los routers de /api/students en sus prefijos reales y en el orden natural. */
function setup(rol: string) {
  const sessions = { resolve: vi.fn(async () => ({ actor: { id: 'u1', rol }, renewed: false, expiresAt: EXPIRES }) as never) };
  const base = { sessions, cookie: { production: false } };
  const profile = { getOwn: vi.fn(async () => ({ id: 's1' })), updateOwn: vi.fn(async () => ({ id: 's1' })) };
  const status = { setEstado: vi.fn(async () => ({ id: 's1' })), getForCompany: vi.fn(async () => ({ id: 's1' })) };
  const forgetter = { forget: vi.fn(async () => undefined) };
  const students = { create: vi.fn(async () => ({ id: 's1' })) };
  const projects = { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const app = new Hono();
  app.route('/api/students', createStudentRoutes({ ...base, students } as never));
  app.route('/api/students/me/projects', createProjectRoutes({ ...base, projects } as never));
  app.route('/api/students/me', createStudentSelfRoutes({ ...base, profile } as never));
  app.route('/api/students', createStudentStatusRoutes({ ...base, status } as never));
  app.route('/api/students', createStudentForgetRoutes({ ...base, forgetter } as never));
  return async (method: string, path: string, body?: unknown) =>
    (
      await app.request(`/api/students${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: 'sesion=tok' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    ).status;
}

describe('composición de /api/students: acceso por rol', () => {
  it('ALUMNO accede a su ficha, estado, proyectos y olvido', async () => {
    const req = setup('ALUMNO');
    expect(await req('GET', '/me')).toBe(200);
    expect(await req('PUT', '/me/estado', { estado: 'activo' })).toBe(200);
    expect(await req('GET', '/me/projects')).toBe(200);
    expect(await req('DELETE', '/me')).toBe(204);
  });
  it('ALUMNO no puede dar de alta alumnos ni operar sobre otros', async () => {
    const req = setup('ALUMNO');
    expect(await req('POST', '', {})).toBe(403);
    expect(await req('PUT', '/abc/estado', { estado: 'activo' })).toBe(403);
    expect(await req('DELETE', '/abc')).toBe(403);
    expect(await req('GET', '/abc')).toBe(403);
  });
  it('SOCIO consulta a un alumno y nada más', async () => {
    const req = setup('SOCIO');
    expect(await req('GET', '/abc')).toBe(200);
    expect(await req('POST', '', {})).toBe(403);
    expect(await req('GET', '/me')).toBe(403);
  });
  it('ADMIN da de alta, cambia estado y olvida a otros; no usa /me', async () => {
    const req = setup('ADMIN');
    expect(await req('POST', '', { email: 'a@b.c' })).toBe(400);
    expect(await req('PUT', '/abc/estado', { estado: 'inactivo' })).toBe(200);
    expect(await req('DELETE', '/abc')).toBe(204);
    expect(await req('GET', '/me')).toBe(403);
  });
});
