import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/controller/app';

const EXPIRES = new Date('2030-01-01T00:00:00Z');

function setup(sendTo: (u: { id: string; email: string }) => Promise<void> = async () => undefined) {
  const ok = (v: unknown = {}) => vi.fn(async () => v as never);
  const verificationSender = { sendTo: vi.fn(sendTo) };
  const catalog = { catalog: ok([]), addToCatalog: ok() };
  const own = { listOwn: ok([]), set: ok(), remove: ok() };
  const app = createApp({
    sessions: {
      resolve: vi.fn(async () => ({ actor: { id: 'adm', rol: 'ADMIN' }, renewed: false, expiresAt: EXPIRES }) as never),
      destroy: ok(),
      create: vi.fn(),
    },
    users: {
      findById: ok({ id: 'u1' }),
      findByEmail: vi.fn(async (email: string) => ({ id: 'nuevo-id', email }) as never),
      createUser: ok({ id: 'nuevo-id', email: 'a@b.es', rol: 'ALUMNO', email_verified: false, created_at: new Date() }),
    },
    verification: { verify: ok('u1') },
    verificationSender,
    editions: { list: ok([]), get: ok(), create: ok(), update: ok(), close: ok() },
    students: { create: ok({ id: 's1', user_id: 'nuevo-id' }) },
    companies: { list: ok([]), create: ok({ id: 'c1' }), update: ok(), setSocia: ok() },
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
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'sesion=tok' },
      body: JSON.stringify(body),
    });
  return { post, verificationSender };
}

const clave = 'una-clave-larga-123';

describe('envío del email de verificación al dar de alta cuentas', () => {
  it('register envía la verificación al usuario creado', async () => {
    const { post, verificationSender } = setup();
    const res = await post('/api/auth/register', { email: 'a@b.es', password: clave, rol: 'ALUMNO' });
    expect(res.status).toBe(201);
    expect(verificationSender.sendTo).toHaveBeenCalledWith({ id: 'nuevo-id', email: 'a@b.es' });
  });

  it('alta de alumno envía la verificación', async () => {
    const { post, verificationSender } = setup();
    const res = await post('/api/students', { email: 'al@b.es', password: clave, edition_id: 'e', nombre: 'Ana' });
    expect(res.status).toBe(201);
    expect(verificationSender.sendTo).toHaveBeenCalledWith({ id: 'nuevo-id', email: 'al@b.es' });
  });

  it('alta de empresa envía la verificación', async () => {
    const { post, verificationSender } = setup();
    const res = await post('/api/companies', { email: 'e@acme.es', password: clave, nombre: 'Acme' });
    expect(res.status).toBe(201);
    expect(verificationSender.sendTo).toHaveBeenCalledWith({ id: 'nuevo-id', email: 'e@acme.es' });
  });

  it('si el envío falla, la cuenta ya creada responde 201 igualmente', async () => {
    const { post } = setup(async () => {
      throw new Error('smtp caído');
    });
    const res = await post('/api/auth/register', { email: 'a@b.es', password: clave, rol: 'ALUMNO' });
    expect(res.status).toBe(201);
  });

  it('un alta rechazada (400) no envía nada', async () => {
    const { post, verificationSender } = setup();
    expect((await post('/api/auth/register', { email: 'a@b.es' })).status).toBe(400);
    expect(verificationSender.sendTo).not.toHaveBeenCalled();
  });
});
