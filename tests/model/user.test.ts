import { describe, it, expect, vi } from 'vitest';
import { createUserModel, EmailYaRegistradoError } from '../../src/model/user';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ADMIN = { id: '22222222-2222-2222-2222-222222222222', rol: 'ADMIN' as const };
const NEW_ID = '33333333-3333-3333-3333-333333333333';
const PASS = 'una-contraseña-segura-123';

function setup(queryImpl?: (sql: string, params: unknown[]) => unknown[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) =>
    queryImpl
      ? queryImpl(sql, params)
      : [{ id: NEW_ID, email: params[0], rol: params[2], email_verified: false, created_at: new Date(0) }],
  );
  const db = { query, ping: vi.fn(), close: vi.fn() } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createUserModel(db, { record }), query, record };
}

describe('modelo User: alta por invitación', () => {
  it('inserta con email_verified=false, hash Argon2id y devuelve proyección sin hash', async () => {
    const { model, query } = setup();
    const user = await model.createUser(ADMIN, { email: 'Ana@Example.com', password: PASS, rol: 'ALUMNO' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into "User"/i);
    expect(sql).not.toMatch(/email_verified\s*[,)]\s*.*values.*true/is);
    expect(params[0]).toBe('Ana@Example.com');
    expect(String(params[1])).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(params[2]).toBe('ALUMNO');
    expect(user).toEqual({ id: NEW_ID, email: 'Ana@Example.com', rol: 'ALUMNO', email_verified: false, created_at: new Date(0) });
    expect(JSON.stringify(user)).not.toMatch(/password|argon2/i);
  });

  it('email duplicado (violación unique 23505) => EmailYaRegistradoError', async () => {
    const { model } = setup(() => {
      throw Object.assign(new Error('dup'), { code: '23505' });
    });
    await expect(model.createUser(ADMIN, { email: 'a@b.co', password: PASS, rol: 'SOCIO' })).rejects.toBeInstanceOf(
      EmailYaRegistradoError,
    );
  });

  it('otros errores de BD se propagan', async () => {
    const { model } = setup(() => {
      throw new Error('boom');
    });
    await expect(model.createUser(ADMIN, { email: 'a@b.co', password: PASS, rol: 'SOCIO' })).rejects.toThrow('boom');
  });

  it('rechaza rol, email o contraseña inválidos sin tocar la BD', async () => {
    const { model, query } = setup();
    await expect(model.createUser(ADMIN, { email: 'a@b.co', password: PASS, rol: 'ROOT' as never })).rejects.toBeInstanceOf(DatosNoValidosError);
    await expect(model.createUser(ADMIN, { email: 'no-es-email', password: PASS, rol: 'ALUMNO' })).rejects.toBeInstanceOf(DatosNoValidosError);
    await expect(model.createUser(ADMIN, { email: 'a@b.co', password: 'corta', rol: 'ALUMNO' })).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });

  it('audita el INSERT con el actor y sin hash', async () => {
    const { model, record } = setup();
    await model.createUser(ADMIN, { email: 'a@b.co', password: PASS, rol: 'SOCIO' });
    expect(record).toHaveBeenCalledTimes(1);
    const entry = (record.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(entry).toMatchObject({ actor: ADMIN, tabla: 'User', idRegistro: NEW_ID, operacion: 'INSERT' });
    expect(JSON.stringify(entry)).not.toMatch(/argon2|password/i);
  });
});

describe('modelo User: consultas', () => {
  it('findByEmail busca por lower(email) y devuelve el hash para el login', async () => {
    const row = { id: NEW_ID, email: 'a@b.co', password_hash: 'h', rol: 'ALUMNO', email_verified: false, created_at: new Date(0) };
    const { model, query } = setup(() => [row]);
    expect(await model.findByEmail('A@B.co')).toEqual(row);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/lower\(email\)\s*=\s*lower\(\$1\)/i);
    expect(params).toEqual(['A@B.co']);
  });

  it('findByEmail devuelve null si no existe', async () => {
    const { model } = setup(() => []);
    expect(await model.findByEmail('x@y.zz')).toBeNull();
  });

  it('findById devuelve proyección pública sin hash', async () => {
    const { model, query } = setup(() => [{ id: NEW_ID, email: 'a@b.co', rol: 'ADMIN', email_verified: true, created_at: new Date(0) }]);
    const u = await model.findById(NEW_ID);
    expect(u).not.toHaveProperty('password_hash');
    expect((query.mock.calls[0] as [string])[0]).not.toMatch(/password_hash/);
    expect(await setup(() => []).model.findById(NEW_ID)).toBeNull();
  });
});
